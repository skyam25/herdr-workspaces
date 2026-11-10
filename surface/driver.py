"""Pty driver for the surface tests. Runs a command in a pty, answers terminal probes, decodes Kitty frames.

No real terminal and no Herdr are involved. Frames are decoded to RGBA and saved as PNG.
"""
import base64
import fcntl
import os
import pty
import re
import select
import signal
import struct
import termios
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
    def __init__(self, width, height, rgba):
        self.width, self.height, self.rgba = width, height, rgba

    def save(self, path):
        data = png_bytes(self.rgba, self.width, self.height)
        with open(path, 'wb') as f:
            f.write(data)
        return len(data)


class Driver:
    def __init__(self, argv, env=None, cols=240, rows=90, xpixel=2400, ypixel=1800, cwd=None, stderr_log='/dev/null'):
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
            fd = os.open(stderr_log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            os.dup2(fd, 2)
            os.close(slave)
            if cwd:
                os.chdir(cwd)
            os.execve(argv[0], argv, full_env)
        os.close(slave)
        self.pid = pid
        self.buf = bytearray()
        self.latest = None
        self.open_chunk = None
        self.exited = False
        self.title = None

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
                self.graphics(bytes(buf[i + 2:end]))
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

    def osc(self, body):
        text = body.decode('latin1')
        if text.startswith(('0;', '2;')):
            self.title = body[2:].decode('utf-8', 'replace')
        elif text.startswith('10;?'):
            self.reply('\x1b]10;rgb:dd/dd/dd\x1b\\')
        elif text.startswith('11;?'):
            self.reply('\x1b]11;rgb:1a/1a/1a\x1b\\')
        elif re.match(r'4;\d+;\?', text):
            idx = text.split(';')[1]
            self.reply('\x1b]4;%s;rgb:80/80/80\x1b\\' % idx)

    def graphics(self, data):
        semi = data.find(b';')
        keys = dict(kv.split('=', 1) for kv in data[1:semi if semi >= 0 else None].decode('latin1').split(',') if '=' in kv)
        payload = data[semi + 1:] if semi >= 0 else b''
        if keys.get('a') == 'q':
            if keys.get('t') == 'd':
                self.reply('\x1b_Gi=%s;OK\x1b\\' % keys.get('i', '0'))
            return
        if keys.get('a') == 'd':
            return
        chunk = self.open_chunk or {'data': bytearray(), 'keys': {}}
        chunk['keys'].update(keys)
        chunk['data'] += payload
        if keys.get('m') == '1':
            self.open_chunk = chunk
            return
        self.open_chunk = None
        self.finish_image(chunk)

    # Keeps the newest full RGBA frame. Tests never read patches.
    def finish_image(self, chunk):
        keys = chunk['keys']
        if keys.get('a') not in ('T', 't', 'f', None):
            return
        if keys.get('f') != '32' or keys.get('t', 'd') != 'd':
            return
        if 'X' in keys or 'Y' in keys or keys.get('p') not in (None, '1'):
            return
        raw = base64.b64decode(bytes(chunk['data']))
        if keys.get('o') == 'z':
            raw = zlib.decompress(raw)
        self.latest = Frame(int(keys.get('s', 0)), int(keys.get('v', 0)), bytes(raw))

    def latest_full(self):
        return self.latest

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
