// Phantom GUI — thin client of the daemon control plane (B1).
const invoke = window.__TAURI_IPC__
  ? (cmd, args) => window.__TAURI__.invoke(cmd, args)
  : async () => { throw new Error('Run inside the Phantom desktop app'); };

const $ = (id) => document.getElementById(id);
let tasks = [];
let activeId = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function refresh() {
  try {
    tasks = await invoke('list_tasks');
    $('task-list').innerHTML = tasks.map((t) => `
      <div class="task ${t.status}">
        <strong>${escapeHtml(t.prompt)}</strong>
        <span>${escapeHtml(t.status)}</span>
        <button data-cancel="${escapeHtml(t.id)}">Cancel</button>
      </div>`).join('') || '<p>No tasks yet.</p>';
    $('task-list').querySelectorAll('[data-cancel]').forEach((b) => {
      b.onclick = async () => { await invoke('cancel_task', { id: b.dataset.cancel }); refresh(); };
    });
    const vm = await invoke('vm_status');
    $('vm-pill').textContent = `VM: ${vm.backend} · ${vm.state}`;
  } catch (e) {
    $('task-list').textContent = e.message || String(e);
  }
}

$('run').onclick = async () => {
  const prompt = $('prompt').value.trim();
  if (!prompt) return;
  const res = await invoke('submit_task', { prompt });
  activeId = res.id;
  $('stop').disabled = false;
  $('takeover').disabled = false;
  $('prompt').value = '';
  refresh();
};

$('stop').onclick = async () => {
  if (activeId) await invoke('cancel_task', { id: activeId });
  activeId = null;
  $('stop').disabled = true;
  $('takeover').disabled = true;
  refresh();
};

$('takeover').onclick = () => {
  $('frame').textContent = 'Take over: connect to the VM with the viewer shown in Settings.';
};

$('approve').onclick = async () => { $('approval').hidden = true; };
$('reject').onclick = async () => { $('approval').hidden = true; };

$('save-settings').onclick = async () => {
  await invoke('set_settings', { settings: {
    provider: $('provider').value, model: $('model').value,
    mode: $('mode').value, max_iterations: 25,
  } });
};

document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    const isSettings = b.dataset.view === 'settings';
    $('settings').hidden = !isSettings;
    $('tasks').hidden = isSettings;
  };
});

refresh();
setInterval(refresh, 2000);
