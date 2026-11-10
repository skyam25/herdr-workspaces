"""Proves the surface host through the pty, in real mode, against the fake hws.

  python3 test/verify.py [scenario ...]

PNGs go to surface/evidence/. Working files go to /tmp/hws-surface-verify.
"""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import Surface, SURFACE  # noqa: E402

ROOT = '/tmp/hws-surface-verify'
EVIDENCE = os.path.join(SURFACE, 'evidence')
os.makedirs(EVIDENCE, exist_ok=True)
DONE = (2296, 1760)
OPEN_TERMINAL = (2085, 1760)
CMD_ENTER = b'\x1b[13;9u'
results = {}


def shot(s, name):
    s.save(os.path.join(EVIDENCE, name + '.png'))


def check(scenario, name, ok, detail=''):
    results.setdefault(scenario, {})[name] = bool(ok)
    print(('PASS' if ok else 'FAIL'), scenario, name, detail, flush=True)


def listening(pid):
    out = subprocess.run(['/usr/sbin/lsof', '-a', '-p', str(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], capture_output=True, text=True)
    return out.stdout.strip()


def read(path):
    with open(path) as f:
        return f.read()


def board_glued():
    name = 'board_glued'
    s = Surface('bg1', ROOT, close=True)
    s.wait(7)
    shot(s, 'board-shell')
    s.stroke()
    shot(s, 'board-stroke')
    payload = json.dumps({'elements': [{'id': 'a', 'type': 'rectangle', 'x': 60, 'y': 560, 'width': 220, 'height': 90, 'label': 'Drawn by agent', 'color': 'blue'}]})
    env = dict(os.environ, COMPANION_SOCKET=s.socket)
    out = subprocess.run(['node', os.path.join(SURFACE, 'app/bin/agent-brief.mjs'), 'draw'], input=payload, capture_output=True, text=True, env=env, timeout=20)
    print('draw', out.returncode, out.stdout.strip(), out.stderr.strip(), flush=True)
    check(name, 'agent_draw', out.returncode == 0)
    s.wait(1.5)
    shot(s, 'board-agent-draw')
    check(name, 'no_tcp_listener', listening(s.d.pid) == '', listening(s.d.pid))
    s.d.click(*DONE)
    s.wait(5)
    log = s.log()
    print(log, flush=True)
    check(name, 'done_called', any(l.startswith('surface done --id bg1 --bundle') and l.endswith('--json') for l in log))
    arts = s.artifacts()
    check(name, 'artifact', len(arts) == 1, arts)
    if arts:
        art = s.artifact(arts[0])
        files = sorted(os.listdir(art))
        prompt = read(os.path.join(art, 'prompt.md'))
        print(files, prompt, flush=True)
        check(name, 'bundle_files', {'prompt.md', 'sketch.png', 'board.excalidraw'} <= set(files), files)
        check(name, 'prompt_absolute', '.feedback/' not in prompt and '/data/bundles/' in prompt)

    # The pty is gone once the host exits, so the driver's pump no longer waits.
    deadline = time.time() + 4
    while time.time() < deadline and 'survived host hangup' not in s.log():
        time.sleep(0.1)
    check(name, 'hws_survived_hangup', 'survived host hangup' in s.log())
    check(name, 'host_exited_on_hangup', s.d.exited)
    s.d.stop()


def note_new():
    name = 'note_new'
    s = Surface('nn1', ROOT, surface_type='note', title='Launch memo')
    s.wait(7)
    s.d.click(1200, 500)
    s.wait(0.5)
    for ch in 'Ship the surface first.':
        s.d.key(ch)
        s.d.pump(0.03)
    s.wait(1)
    shot(s, 'note-typed')
    s.d.key(CMD_ENTER)
    s.wait(4)
    shot(s, 'note-after-cmd-enter')
    log = s.log()
    print(log, flush=True)
    check(name, 'cmd_enter_done', any(l.startswith('surface done') for l in log))
    arts = s.artifacts()
    if arts:
        art = s.artifact(arts[0])
        print(sorted(os.listdir(art)), read(os.path.join(art, 'prompt.md')), flush=True)
        check(name, 'text_in_prompt', 'Ship the surface first.' in read(os.path.join(art, 'prompt.md')))
    check(name, 'ctrl_q', s.stop())


def note_file():
    name = 'note_file'
    folder = os.path.join(ROOT, 'proj-note')
    os.makedirs(os.path.join(folder, 'docs'), exist_ok=True)
    path = os.path.join(folder, 'docs', 'spec.md')
    with open(path, 'w') as f:
        f.write('# Spec\n\nThe surface opens this file.\n')
    s = Surface('nf1', ROOT, surface_type='note', title='spec', file=path, folder=folder)
    s.wait(8)
    shot(s, 'note-file')
    s.d.click(1200, 400)
    s.wait(0.5)
    s.d.key(b'\x1b[1;9B')
    s.d.pump(0.2)
    for ch in ' Edited.':
        s.d.key(ch)
        s.d.pump(0.03)
    s.wait(1.5)
    s.d.click(*DONE)
    s.wait(4)
    shot(s, 'note-file-after-done')
    arts = s.artifacts()
    check(name, 'artifact', len(arts) == 1, arts)
    if arts:
        art = s.artifact(arts[0])
        prompt = read(os.path.join(art, 'prompt.md'))
        print(sorted(os.listdir(art)), prompt, flush=True)
        check(name, 'names_project_path', 'docs/spec.md' in prompt)
        check(name, 'draft_has_edit', 'Edited.' in read(os.path.join(art, 'draft.md')))
    leftovers = os.listdir(os.path.join(folder, '.feedback', 'sketches')) if os.path.isdir(os.path.join(folder, '.feedback', 'sketches')) else []
    check(name, 'bundle_left_project', leftovers == [], leftovers)
    s.stop()


def pin(s, text):
    s.d.click(500, 330)
    s.wait(1.5)
    for ch in text:
        s.d.key(ch)
        s.d.pump(0.03)
    s.wait(1.5)


def page():
    name = 'page'
    folder = os.path.join(ROOT, 'proj-page')
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, 'demo.html')
    with open(path, 'w') as f:
        f.write('<!doctype html><body style="font:20px -apple-system;padding:40px"><h1>Review page</h1>'
                '<p id="p"></p><script>document.getElementById("p").textContent='
                '"window.companion in this frame: "+typeof window.companion+" / process: "+typeof process;</script></body>')
    s = Surface('pg1', ROOT, surface_type='page', title='demo', file=path, folder=folder)
    s.wait(9)
    shot(s, 'page-review')
    pin(s, 'tighten this')
    shot(s, 'page-pinned')
    s.d.key(CMD_ENTER)
    s.wait(5)
    shot(s, 'page-after-done')
    arts = s.artifacts()
    print(s.log(), arts, flush=True)
    check(name, 'artifact', len(arts) == 1, arts)
    if arts:
        art = s.artifact(arts[0])
        files = sorted(os.listdir(art))
        review = read(os.path.join(art, 'review.md'))
        print(files, read(os.path.join(art, 'prompt.md')), review, flush=True)
        check(name, 'comment_in_review', 'tighten this' in review)
        check(name, 'no_project_paths', '.feedback/' not in review)
    s.stop()


def demo_page(folder_name):
    folder = os.path.join(ROOT, folder_name)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, 'demo.html')
    with open(path, 'w') as f:
        f.write('<!doctype html><body style="font:20px -apple-system;padding:40px"><h1>Review page</h1><p>Body text</p></body>')
    return folder, path


def drafts_text(s):
    folder = os.path.join(s.data, 'drafts')
    names = sorted(os.listdir(folder)) if os.path.isdir(folder) else []
    return '\n'.join(read(os.path.join(folder, n)) for n in names if os.path.isfile(os.path.join(folder, n)))


# A second comment files a second round that holds only the new comment.
def check_second_round(name, s, press, wait):
    pin(s, 'second look')
    press()
    s.wait(wait)
    arts = s.artifacts()
    check(name, 'second_round', len(arts) == 2, arts)
    if len(arts) == 2:
        review = read(os.path.join(s.artifact(arts[1]), 'review.md'))
        check(name, 'second_round_has_only_new_comment', 'second look' in review and 'tighten this' not in review, review)


def page_reopen():
    name = 'page_reopen'
    folder, path = demo_page('proj-reopen')
    s = Surface('pr1', ROOT, surface_type='page', title='demo', file=path, folder=folder, close=True)
    s.wait(9)
    pin(s, 'tighten this')
    check(name, 'comment_saved_before_done', 'tighten this' in drafts_text(s))
    s.d.key(CMD_ENTER)
    s.wait(6)
    check(name, 'artifact', len(s.artifacts()) == 1, s.artifacts())
    check(name, 'host_exited_on_hangup', s.d.exited)
    s.d.stop()
    again = Surface('pr1', ROOT, surface_type='page', title='demo', file=path, folder=folder, fresh=False)
    again.wait(9)
    shot(again, 'page-reopened')
    check(name, 'delivered_comment_gone', 'tighten this' not in drafts_text(again), drafts_text(again)[:200])
    check(name, 'marker_cleared', not os.path.exists(os.path.join(again.data, 'handed-off.json')))
    check_second_round(name, again, lambda: again.d.key(CMD_ENTER), 5)
    again.stop()


def page_standalone():
    name = 'page_standalone'
    folder, path = demo_page('proj-solo')
    s = Surface('ps1', ROOT, surface_type='page', title='demo', file=path, folder=folder, terminal='', mode='standalone')
    s.wait(9)
    pin(s, 'tighten this')
    s.d.click(*DONE)
    s.wait(6)
    shot(s, 'page-standalone-after-copy')
    log = s.log()
    print(log, flush=True)
    check(name, 'copy_makes_artifact', sum(l.startswith('surface done') for l in log) == 1)
    check(name, 'copy_runs_link', sum(l.startswith('link a0') for l in log) == 1)
    check(name, 'delivered_comment_gone', 'tighten this' not in drafts_text(s), drafts_text(s)[:200])
    check(name, 'still_open', not s.d.exited)
    s.d.click(*DONE)
    s.wait(4)
    log = s.log()
    print(log, flush=True)
    check(name, 'nothing_new_copies_same_link', sum(l.startswith('link a0') for l in log) == 2)
    check(name, 'nothing_new_makes_no_artifact', sum(l.startswith('surface done') for l in log) == 1)
    check_second_round(name, s, lambda: s.d.click(*DONE), 6)
    s.stop()


def standalone():
    name = 'standalone'
    s = Surface('sa1', ROOT, terminal='', mode='standalone')
    s.wait(7)
    shot(s, 'standalone-actions')
    s.stroke()
    s.d.click(*DONE)
    s.wait(4)
    shot(s, 'standalone-after-copy')
    log = s.log()
    print(log, flush=True)
    check(name, 'copy_makes_artifact', sum(l.startswith('surface done') for l in log) == 1)
    check(name, 'copy_runs_link', any(l.startswith('link a0') for l in log))
    clip = read(s.clip) if os.path.exists(s.clip) else ''
    check(name, 'clipboard', clip.startswith('@') and clip.endswith('prompt.md'), clip)
    s.d.click(*OPEN_TERMINAL)
    s.wait(4)
    shot(s, 'standalone-after-open-terminal')
    log = s.log()
    print(log, flush=True)
    check(name, 'open_terminal_runs', any(l.startswith('artifact terminal a0') for l in log))
    check(name, 'unchanged_reuses_artifact', sum(l.startswith('surface done') for l in log) == 1)
    s.stroke(x0=700, y0=1000, n=30)
    s.d.click(*DONE)
    s.wait(4)
    log = s.log()
    print(log, flush=True)
    check(name, 'changed_makes_new_artifact', sum(l.startswith('surface done') for l in log) == 2)
    check(name, 'still_open', not s.d.exited)
    s.stop()


def terminal_ended():
    name = 'terminal_ended'
    s = Surface('te1', ROOT, mode='standalone')
    s.wait(7)
    s.stroke()
    shot(s, 'terminal-ended-before')
    s.d.click(*DONE)
    s.wait(4)
    shot(s, 'terminal-ended-after')
    check(name, 'artifact', len(s.artifacts()) == 1)
    check(name, 'still_open', not s.d.exited)
    s.d.click(*DONE)
    s.wait(4)
    log = s.log()
    print(log, flush=True)
    check(name, 'copy_link_after_flip', any(l.startswith('link a0') for l in log))
    s.stop()


def failing():
    name = 'failing'
    s = Surface('fl1', ROOT, mode='failing')
    s.wait(7)
    s.stroke()
    s.d.click(*DONE)
    s.wait(3)
    shot(s, 'done-failed')
    check(name, 'still_open', not s.d.exited)
    s.stop()


def two():
    name = 'two'
    a = Surface('tw1', ROOT, title='first')
    b = Surface('tw2', ROOT, title='second')
    for _ in range(16):
        a.wait(0.25)
        b.wait(0.25)
    a.stroke()
    b.stroke(x0=700, y0=900, n=40)
    for _ in range(6):
        a.wait(0.25)
        b.wait(0.25)
    shot(a, 'two-surfaces-first')
    shot(b, 'two-surfaces-second')
    check(name, 'both_alive', not a.d.exited and not b.d.exited)
    check(name, 'first_status', a.cli('status').returncode == 0)
    check(name, 'second_status', b.cli('status').returncode == 0)
    a.stop()
    b.stop()


ALL = {f.__name__: f for f in [board_glued, note_new, note_file, page, page_reopen, page_standalone, standalone, terminal_ended, failing, two]}
for key in sys.argv[1:] or list(ALL):
    ALL[key]()
out = os.path.join(EVIDENCE, 'results.json')
previous = json.load(open(out)) if os.path.exists(out) and sys.argv[1:] else {}
previous.update(results)
with open(out, 'w') as f:
    json.dump(previous, f, indent=2)
print(json.dumps(results, indent=2))
