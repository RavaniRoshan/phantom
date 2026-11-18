"""Regenerate the W0.11 golden-task YAML corpus (60 tasks: 20 per backend).

    python scripts/generate_bench_tasks.py

The YAML files are committed; this script exists only so the corpus can be
extended consistently. Task ids are stable and sorted.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "bench" / "tasks"
OUT.mkdir(parents=True, exist_ok=True)


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def write(name: str, tasks: list[str]) -> None:
    (OUT / name).write_text("\n".join(tasks).rstrip() + "\n", encoding="utf-8")
    print(f"wrote {OUT / name} ({len([t for t in tasks if t.startswith('- id:')])} tasks)")


# --- files / CLI: deterministic, runnable on any CI runner -------------------
files = []
for i in range(1, 11):
    text = f"phantom-file-{i:02d}"
    files += [
        f"- id: files-{i:02d}",
        "  backend: files",
        f"  prompt: 'Create a file containing {text}'",
        "  setup:",
        f"    - type: mkdir",
        f"      path: {q('{workdir}/files')}",
        "  action:",
        "    type: write_file",
        f"    path: {q('{workdir}/files/task-' + f'{i:02d}' + '.txt')}",
        f"    content: {q(text)}",
        "  check:",
        "    type: file_contains",
        f"    path: {q('{workdir}/files/task-' + f'{i:02d}' + '.txt')}",
        f"    text: {q(text)}",
        f"  artifacts: [{q('{workdir}/files/task-' + f'{i:02d}' + '.txt')}]",
    ]
for i in range(11, 15):
    files += [
        f"- id: files-{i:02d}",
        "  backend: files",
        "  prompt: 'Create a task directory'",
        "  setup: []",
        "  action:",
        "    type: mkdir",
        f"    path: {q('{workdir}/dirs/d' + f'{i:02d}')}",
        "  check:",
        "    type: dir_exists",
        f"    path: {q('{workdir}/dirs/d' + f'{i:02d}')}",
        f"  artifacts: [{q('{workdir}/dirs/d' + f'{i:02d}')}]",
    ]
for i in range(15, 17):
    p = q("{workdir}/files/removed-" + f"{i:02d}" + ".txt")
    files += [
        f"- id: files-{i:02d}",
        "  backend: files",
        "  prompt: 'Remove a temporary file'",
        "  setup:",
        "    - type: write_file",
        f"      path: {p}",
        "      content: transient",
        "  action:",
        "    type: remove_file",
        f"    path: {p}",
        "  check:",
        "    type: file_not_exists",
        f"    path: {p}",
        "  artifacts: []",
    ]
for i in range(17, 19):
    files += [
        f"- id: files-{i:02d}",
        "  backend: files",
        "  prompt: 'Create an artifact file'",
        "  setup: []",
        "  action:",
        "    type: write_file",
        f"    path: {q('{workdir}/files/artifact-' + f'{i:02d}' + '.txt')}",
        "    content: artifact",
        "  check:",
        "    type: file_exists",
        f"    path: {q('{workdir}/files/artifact-' + f'{i:02d}' + '.txt')}",
        f"  artifacts: [{q('{workdir}/files/artifact-' + f'{i:02d}' + '.txt')}]",
    ]
for i in range(19, 21):
    files += [
        f"- id: files-{i:02d}",
        "  backend: files",
        "  prompt: 'Write an exact-content report'",
        "  setup: []",
        "  action:",
        "    type: write_file",
        f"    path: {q('{workdir}/files/exact-' + f'{i:02d}' + '.txt')}",
        "    content: exact-content",
        "  check:",
        "    type: file_equals",
        f"    path: {q('{workdir}/files/exact-' + f'{i:02d}' + '.txt')}",
        "    content: exact-content",
        f"  artifacts: [{q('{workdir}/files/exact-' + f'{i:02d}' + '.txt')}]",
    ]
write("files.yaml", files)

# --- browser: live tasks (require LLM service + browser backend) -------------
browser = []
sites = [
    "https://example.com", "https://example.org", "https://example.net",
    "https://www.wikipedia.org", "https://www.python.org",
]
for i in range(1, 21):
    site = sites[(i - 1) % len(sites)]
    browser += [
        f"- id: browser-{i:02d}",
        "  backend: browser",
        f"  prompt: {q(f'Open {site} and save a short summary of the page to ' + '{workdir}/browser/task-' + f'{i:02d}' + '.md')}",
        "  setup:",
        "    - type: mkdir",
        "      path: '{workdir}/browser'",
        "  check:",
        "    type: file_contains",
        f"    path: {q('{workdir}/browser/task-' + f'{i:02d}' + '.md')}",
        "    text: 'summary'",
        f"  artifacts: [{q('{workdir}/browser/task-' + f'{i:02d}' + '.md')}]",
    ]
write("browser.yaml", browser)

# --- desktop: live tasks (require hidden-desktop feasibility + Windows) ------
desktop = []
apps = ["Notepad", "Chrome", "Excel", "Explorer", "Settings dialog"]
for i in range(1, 21):
    app = apps[(i - 1) % len(apps)]
    desktop += [
        f"- id: desktop-{i:02d}",
        "  backend: desktop",
        f"  prompt: {q(f'Using {app}, complete desktop step {i:02d} and write a completion marker')}",
        "  setup:",
        "    - type: mkdir",
        "      path: '{workdir}/desktop/artifacts'",
        "  check:",
        "    type: file_exists",
        f"    path: {q('{workdir}/desktop/artifacts/' + f'desktop-{i:02d}.done')}",
        f"  artifacts: [{q('{workdir}/desktop/artifacts/' + f'desktop-{i:02d}.done')}]",
    ]
write("desktop.yaml", desktop)
