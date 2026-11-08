"""Pty driver for the spike. Runs a command in a pty, answers terminal probes, decodes Kitty frames.

No real terminal and no Herdr are involved. Frames are decoded to RGBA and saved as PNG.
`--fake-herdr` also serves a stand-in Herdr graphics socket so the full-frame path can be measured.
"""
import base64
import fcntl
import json
import os
import pty
import re
import select
import signal
import socket
import struct
import subprocess
import termios
import threading
import time
import zlib


def png_bytes(rgba, w, h):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]
    def chunk(tag, data):
        c = zlib.crc32(tag + data) & 0xffffffff
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', c)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b''))


class Frame:
    def __init__(self, width, height, rgba, wire_bytes, compressed, kind, t):
        self.width, self.height, self.rgba = width, height, rgba
        self.wire_bytes, self.compressed = wire_bytes, compressed
        self.kind, self.t = kind, t

    def save(self, path):
        data = png_bytes(self.rgba, self.width, self.height)
        with open(path, 'wb') as f:
            f.write(data)
        return len(data)


class FakeHerdr:
    """Serves the pane.graphics socket the Pixel engine expects from Herdr. Under /tmp, not the real one."""

    def __init__(self, directory, cell=(10, 20)):
        self.directory = directory
        self.frames = []
        self.cell = cell
        os.makedirs(directory, exist_ok=True)
        self.path = '/tmp/ab-fake-herdr-%d.sock' % os.getpid()
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(self.path)
        self.sock.listen(8)
        self.stop = False
        self.latest = None
        threading.Thread(target=self.accept_loop, daemon=True).start()

    def accept_loop(self):
        while not self.stop:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self.serve, args=(conn,), daemon=True).start()

    def serve(self, conn):
        f = conn.makefile('rwb', buffering=0)
        line = f.readline()
        if b'pane.graphics.info' in line:
            info = {'id': 'info', 'result': {'type': 'pane_graphics_info', 'cell_width_px': self.cell[0],
                    'cell_height_px': self.cell[1], 'pane_visible': True, 'file_frame_directory': self.directory,
                    'file_frame_formats': ['rgba', 'bgra'], 'max_layers_per_pane': 16, 'pixel_mouse': True,
                    'file_frame_transport': 'direct-kitty'}}
            f.write((json.dumps(info) + '\n').encode())
            return
        f.write((json.dumps({'id': 'stream', 'result': {'type': 'ok'}}) + '\n').encode())
        while True:
            header = f.readline()
            if not header:
                return
            frame = json.loads(header)
            t = time.time()
            path = frame['file']['path']
            w, h = frame['image_width'], frame['image_height']
            size = os.path.getsize(path)
            self.frames.append({'t': t, 'w': w, 'h': h, 'file_bytes': size, 'header_bytes': len(header)})
            self.latest = (path, w, h, frame.get('format'))
            f.write(b'{"id":"stream","result":{"type":"pane_graphics_frame_ack"}}\n')

    def snapshot_latest(self, out):
        if not self.latest:
            return None
        path, w, h, fmt = self.latest
        with open(path, 'rb') as fh:
            data = fh.read(w * h * 4)
        data = bytearray(data)
        if fmt == 'bgra':
            for i in range(0, len(data), 4):
                data[i], data[i + 2] = data[i + 2], data[i]
        with open(out, 'wb') as fh:
            fh.write(png_bytes(bytes(data), w, h))
        return out


class Driver:
    def __init__(self, argv, env=None, cols=240, rows=90, xpixel=2400, ypixel=1800, cwd=None):
        self.cols, self.rows, self.xpixel, self.ypixel = cols, rows, xpixel, ypixel
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, xpixel, ypixel))
        full_env = dict(env or os.environ)
        self.tty = os.ttyname(slave)
        full_env['PIXEL_TTY'] = self.tty
        pid = os.fork()
        if pid == 0:
            os.close(self.master)
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            os.dup2(slave, 0)
            os.dup2(slave, 1)
            stderr_log = os.environ.get('SPIKE_STDERR', '/dev/null')
            fd = os.open(stderr_log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            os.dup2(fd, 2)
            os.close(slave)
            if cwd:
                os.chdir(cwd)
            os.execve(argv[0], argv, full_env)
        os.close(slave)
        self.pid = pid
        self.buf = bytearray()
        self.frames = []
        self.frame_bytes_total = 0
        self.total_wire = 0
        self.sync_wire = []
        self.sync_start = None
        self.open_chunk = None
        self.exited = False
        self.mouse_pixels = False

    def write(self, data):
        os.write(self.master, data)

    def reply(self, text):
        self.write(text.encode('latin1') if isinstance(text, str) else text)

    def pump(self, seconds):
        deadline = time.time() + seconds
        while True:
            timeout = deadline - time.time()
            if timeout <= 0:
                return
            r, _, _ = select.select([self.master], [], [], min(timeout, 0.05))
            if r:
                try:
                    data = os.read(self.master, 1 << 22)
                except OSError:
                    self.exited = True
                    return
                if not data:
                    self.exited = True
                    return
                self.total_wire += len(data)
                self.buf += data
                self.parse()

    def parse(self):
        buf = self.buf
        i = 0
        n = len(buf)
        while i < n:
            esc = buf.find(b'\x1b', i)
            if esc < 0:
                i = n
                break
            i = esc
            if i + 1 >= n:
                break
            kind = buf[i + 1:i + 2]
            if kind == b'_':
                end = buf.find(b'\x1b\\', i + 2)
                if end < 0:
                    break
                self.graphics(bytes(buf[i + 2:end]), end + 2 - i)
                i = end + 2
            elif kind == b'[':
                j = i + 2
                while j < n and not (0x40 <= buf[j] <= 0x7e):
                    j += 1
                if j >= n:
                    break
                self.csi(bytes(buf[i + 2:j + 1]))
                i = j + 1
            elif kind == b']':
                bel = buf.find(b'\x07', i + 2)
                st = buf.find(b'\x1b\\', i + 2)
                ends = [e for e in (bel, st) if e >= 0]
                if not ends:
                    break
                end = min(ends)
                self.osc(bytes(buf[i + 2:end]))
                i = end + (2 if end == st else 1)
            elif kind == b'P':
                st = buf.find(b'\x1b\\', i + 2)
                if st < 0:
                    break
                i = st + 2
            else:
                i += 2
        self.buf = buf[i:]

    def csi(self, body):
        text = body.decode('latin1')
        if text == '?u':
            self.reply('\x1b[?1u')
        elif text == '?1016$p':
            self.mouse_pixels = True
            self.reply('\x1b[?1016;1$y')
        elif text == '?5522$p':
            self.reply('\x1b[?5522;0$y')
        elif text == '?2031$p':
            self.reply('\x1b[?2031;0$y')
        elif text == '>0q':
            self.reply('\x1bP>|Unknown 1.0\x1b\\')
        elif text == '16t':
            self.reply('\x1b[6;%d;%dt' % (self.ypixel // self.rows, self.xpixel // self.cols))
        elif text == 'c':
            self.reply('\x1b[?62;4c')
        elif text == '?2026h':
            self.sync_start = self.total_wire
        elif text == '?2026l' and self.sync_start is not None:
            self.sync_wire.append(self.total_wire - self.sync_start)
            self.sync_start = None

    def osc(self, body):
        text = body.decode('latin1')
        if text.startswith('10;?'):
            self.reply('\x1b]10;rgb:dd/dd/dd\x1b\\')
        elif text.startswith('11;?'):
            self.reply('\x1b]11;rgb:1a/1a/1a\x1b\\')
        elif re.match(r'4;\d+;\?', text):
            idx = text.split(';')[1]
            self.reply('\x1b]4;%s;rgb:80/80/80\x1b\\' % idx)

    def graphics(self, data, length):
        semi = data.find(b';')
        keys = dict(kv.split('=', 1) for kv in data[1:semi if semi >= 0 else None].decode('latin1').split(',') if '=' in kv)
        payload = data[semi + 1:] if semi >= 0 else b''
        if keys.get('a') == 'q':
            if keys.get('t') == 'd':
                self.reply('\x1b_Gi=%s;OK\x1b\\' % keys.get('i', '0'))
            return
        if keys.get('a') == 'd':
            return
        chunk = self.open_chunk or {'data': bytearray(), 'keys': {}, 'wire': 0}
        chunk['keys'].update(keys)
        chunk['data'] += payload
        chunk['wire'] += length
        if keys.get('m') == '1':
            self.open_chunk = chunk
            return
        self.open_chunk = None
        self.finish_image(chunk)

    def finish_image(self, chunk):
        keys = chunk['keys']
        if os.environ.get('SPIKE_DEBUG'):
            print('IMG', keys, len(chunk['data']), chunk['wire'], flush=True)
        if keys.get('a') not in ('T', 't', 'f', None):
            return
        if keys.get('f') != '32' or keys.get('t', 'd') != 'd':
            self.frames.append(Frame(int(keys.get('s', 0)), int(keys.get('v', 0)), None, chunk['wire'], 0, 'non-inline:' + keys.get('t', '?'), time.time()))
            return
        raw = base64.b64decode(bytes(chunk['data']))
        compressed = len(raw)
        if keys.get('o') == 'z':
            raw = zlib.decompress(raw)
        w, h = int(keys.get('s', 0)), int(keys.get('v', 0))
        patched = 'X' in keys or 'Y' in keys or keys.get('p') not in (None, '1')
        kind = 'patch' if patched else 'full'
        self.frames.append(Frame(w, h, bytes(raw), chunk['wire'], compressed, kind, time.time()))

    def full_frames(self):
        return [f for f in self.frames if f.kind == 'full']

    def latest_full(self):
        fulls = self.full_frames()
        return fulls[-1] if fulls else None

    def mouse(self, cb, x, y, release=False):
        # SGR pixel mode reports 1-based pixels.
        self.write(('\x1b[<%d;%d;%d%s' % (cb, x + 1, y + 1, 'm' if release else 'M')).encode())

    def press(self, x, y, button=0):
        self.mouse(button, x, y)

    def release(self, x, y, button=0):
        self.mouse(button, x, y, release=True)

    def drag(self, x, y, button=0):
        self.mouse(32 + button, x, y)

    def move(self, x, y):
        self.mouse(35, x, y)

    def click(self, x, y, settle=0.3):
        self.move(x, y)
        self.pump(0.05)
        self.press(x, y)
        self.pump(0.05)
        self.release(x, y)
        self.pump(settle)

    def key(self, ch):
        self.write(ch.encode() if isinstance(ch, str) else ch)

    def stop(self, sig=signal.SIGTERM):
        try:
            os.kill(self.pid, sig)
        except ProcessLookupError:
            pass
        deadline = time.time() + 4
        while time.time() < deadline and not self.exited:
            self.pump(0.1)
        try:
            os.kill(self.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            pass
