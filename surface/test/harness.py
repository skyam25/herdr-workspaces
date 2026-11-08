"""Starts surfaces under the pty driver, with isolated sockets and data folders."""
import os
import shutil
import subprocess
import sys

SURFACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SURFACE)
from driver import Driver  # noqa: E402

RUN_SH = os.path.join(SURFACE, 'run.sh')
FAKE_HWS = os.path.join(SURFACE, 'test', 'fake-hws')
CLI = os.path.join(SURFACE, 'app', 'bin', 'agent-brief.mjs')


def scrubbed():
    drop = ('HERDR', 'GHOSTTY', 'TERM_PROGRAM', 'KITTY', 'TMUX', 'ELECTRON_RUN_AS_NODE', 'TERMINAL_BROWSER', 'COMPANION_', 'HWS_', 'HC_')
    return {k: v for k, v in os.environ.items() if not k.startswith(drop)}


class Surface:
    def __init__(self, sid, root, surface_type='board', title='flow', file='', terminal='t1', mode='glued', close=False, folder=None, cols=240, rows=90):
        self.sid = sid
        self.root = os.path.join(root, sid)
        shutil.rmtree(self.root, ignore_errors=True)
        os.makedirs(self.root)
        self.data = os.path.join(self.root, 'data')
        self.fake = os.path.join(self.root, 'hws')
        self.clip = os.path.join(self.root, 'clipboard.txt')
        self.socket = '/tmp/hws-v-%s.sock' % sid
        if os.path.exists(self.socket):
            os.unlink(self.socket)
        env = scrubbed()
        env.update({
            'TERM': 'xterm-kitty',
            'PIXEL_DISPLAY_SCALE': '2',
            'TERMINAL_BROWSER_FRAMES': 'inline',
            'TERMINAL_BROWSER_PRESENT': 'full',
            'XDG_CACHE_HOME': os.path.join(self.root, 'cache'),
            'HWS_HOME': os.path.join(self.root, 'state'),
            'HWS_SURFACE_ID': sid,
            'HWS_WORKSPACE_ID': 'standalone' if not terminal else 'spc1',
            'HWS_TERMINAL': terminal,
            'HWS_SURFACE_TYPE': surface_type,
            'HWS_SURFACE_TITLE': title,
            'HWS_SURFACE_FILE': file,
            'HWS_FOLDER': folder or self.root,
            'COMPANION_SOCKET': self.socket,
            'COMPANION_DATA_DIR': self.data,
            'HWS_BIN': FAKE_HWS,
            'HWS_CLIPBOARD_FILE': self.clip,
            'FAKE_HWS_DIR': self.fake,
            'FAKE_HWS_MODE': mode,
            'FAKE_HWS_CLOSE': '1' if close else '0',
        })
        self.d = Driver(['/bin/zsh', RUN_SH], env=env, cols=cols, rows=rows, xpixel=cols * 10, ypixel=rows * 20,
                        stderr_log=os.path.join(self.root, 'driver.stderr.log'))

    def wait(self, seconds):
        self.d.pump(seconds)

    def save(self, path):
        frame = self.d.latest_full()
        if frame is None:
            raise SystemExit('no frame for %s' % path)
        frame.save(path)
        print('saved', path, flush=True)

    def stroke(self, x0=700, y0=500, n=60):
        self.d.key('p')
        self.d.pump(0.5)
        self.d.move(x0, y0)
        self.d.pump(0.02)
        self.d.press(x0, y0)
        self.d.pump(0.02)
        x, y = x0, y0
        for i in range(1, n + 1):
            x, y = x0 + i * 15, y0 + (i % 12) * 20
            self.d.drag(x, y)
            self.d.pump(0.016)
        self.d.release(x, y)
        self.d.pump(1)

    def log(self):
        path = os.path.join(self.fake, 'hws.log')
        return open(path).read().splitlines() if os.path.exists(path) else []

    def artifacts(self):
        path = os.path.join(self.fake, 'artifacts')
        return sorted(os.listdir(path)) if os.path.isdir(path) else []

    def artifact(self, name):
        return os.path.join(self.fake, 'artifacts', name)

    def cli(self, *args):
        env = scrubbed()
        env['COMPANION_SOCKET'] = self.socket
        out = subprocess.run(['node', CLI, *args], capture_output=True, text=True, timeout=20, env=env)
        print('cli', args, out.returncode, out.stdout.strip()[:300], out.stderr.strip()[:300], flush=True)
        return out

    def stop(self):
        self.d.key(b'\x1b[113;5u')
        self.d.pump(4)
        print('exited after ctrl+q:', self.d.exited, flush=True)
        exited = self.d.exited
        self.d.stop()
        return exited
