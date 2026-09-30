const config = window.CLEAN_BUDDY_CONFIG || {};
let createClient = null;
if (config.supabaseUrl?.startsWith('https://') && config.supabaseAnonKey && !config.supabaseAnonKey.includes('YOUR_')) {
  try {
    ({ createClient } = await import('https://esm.sh/@supabase/supabase-js@2'));
  } catch (error) {
    console.warn('CLEAN BUDDY is opening in prototype mode because its account service is unavailable.', error);
  }
}
const authView = document.querySelector('#auth-view');
const awarenessView = document.querySelector('#awareness-view');
const appView = document.querySelector('#app-view');
const form = document.querySelector('#auth-form');
const notice = document.querySelector('#form-notice');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const dialog = document.querySelector('#action-dialog');
const dialogTitle = document.querySelector('#dialog-title');
const dialogCopy = document.querySelector('#dialog-copy');
const dialogFields = document.querySelector('#dialog-fields');
const dialogMessage = document.querySelector('#dialog-message');
const dialogSubmit = document.querySelector('#dialog-submit');
const supabase = createClient ? createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
let registerMode = false;
let verifyingSignup = false;
let currentAction = '';
let demoMode = !supabase;
let activeUserId = null;

if (!supabase) {
  document.querySelector('.fine-print').textContent = 'Prototype mode: use any valid email and a password with 8+ characters.';
}

const DEMO_KEY = 'clean-buddy-demo-v1';
function readDemoData() {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY)) || { name: 'Aanya', reports: [], pickups: [], feedback: [], reminders: [] };
  } catch {
    return { name: 'Aanya', reports: [], pickups: [], feedback: [], reminders: [] };
  }
}
function writeDemoData(data) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(data));
}
function enterDemoAwareness(displayName) {
  demoMode = true;
  const data = readDemoData();
  const name = displayName || data.name || 'Aanya';
  data.name = name;
  writeDemoData(data);
  document.querySelector('#user-name').textContent = name;
  document.querySelector('#user-avatar').textContent = name[0].toUpperCase();
  document.querySelector('#admin-action').hidden = false;
  document.querySelector('#action-count').textContent = '7 dashboard actions';
  activeUserId = 'demo';
  authView.hidden = true;
  awarenessView.hidden = false;
  appView.hidden = true;
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = false;
}
function clearNotice() {
  notice.hidden = true;
  notice.classList.remove('error');
  document.querySelectorAll('.error').forEach((el) => { el.textContent = ''; });
}
function emailOk(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function showConfigHelp() {
  showNotice('Connect your Supabase project in config.js and run supabase-setup.sql before using account features.', true);
}
function friendlyError(error) {
  if (/invalid login credentials/i.test(error.message)) return 'Email or password is incorrect, or your email has not been verified.';
  if (/email not confirmed/i.test(error.message)) return 'Verify your email with the code we sent, then log in.';
  if (/rate limit|too many requests/i.test(error.message)) return 'Too many attempts. Please wait a little before trying again.';
  return error.message || 'Something went wrong. Please try again.';
}
function enterAwareness(user) {
  demoMode = false;
  activeUserId = user.id;
  const name = (user.user_metadata?.full_name || user.email?.split('@')[0] || 'friend').trim().split(/\s+/)[0];
  document.querySelector('#user-name').textContent = name;
  document.querySelector('#user-avatar').textContent = name[0].toUpperCase();
  const isAdmin = user.app_metadata?.role === 'admin';
  document.querySelector('#admin-action').hidden = !isAdmin;
  document.querySelector('#action-count').textContent = isAdmin ? '7 dashboard actions' : '6 ways to help';
  authView.hidden = true;
  awarenessView.hidden = false;
  appView.hidden = true;
}
async function showDashboard() {
  authView.hidden = true;
  awarenessView.hidden = true;
  appView.hidden = false;
  await refreshDashboard();
}

document.querySelector('#toggle-password').addEventListener('click', (event) => {
  const visible = passwordInput.type === 'password';
  passwordInput.type = visible ? 'text' : 'password';
  event.currentTarget.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
});
document.querySelector('#generate-password').addEventListener('click', () => {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@$%';
  const bytes = crypto.getRandomValues(new Uint32Array(18));
  passwordInput.value = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  passwordInput.type = 'text';
  passwordInput.focus();
  showNotice('A strong password is ready. Save it somewhere safe before continuing.');
});
document.querySelector('#register-toggle').addEventListener('click', () => {
  registerMode = !registerMode;
  verifyingSignup = false;
  clearNotice();
  document.querySelector('#otp-field').hidden = true;
  document.querySelector('#name-field').hidden = !registerMode;
  document.querySelector('#login-options').hidden = registerMode;
  document.querySelector('#form-kicker').textContent = registerMode ? 'JOIN THE COMMUNITY' : 'WELCOME BACK';
  document.querySelector('#auth-title').innerHTML = registerMode ? 'Let’s get you <em>started.</em>' : 'Let’s get you <em>in.</em>';
  document.querySelector('#auth-subtitle').textContent = registerMode ? 'Create an account and make your first good move.' : 'Sign in to keep your good work going.';
  document.querySelector('#submit-label').textContent = registerMode ? 'Create account' : 'Log in with email';
  document.querySelector('#register-toggle').textContent = registerMode ? 'Log in' : 'Register';
  document.querySelector('#switch-auth').firstChild.textContent = registerMode ? 'Already have an account? ' : 'Don’t have an account? ';
  passwordInput.autocomplete = registerMode ? 'new-password' : 'current-password';
});
document.querySelector('#forgot-password').addEventListener('click', async () => {
  const email = emailInput.value.trim().toLowerCase();
  if (!emailOk(email)) { showNotice('Enter a valid email address first.', true); emailInput.focus(); return; }
  if (!supabase) { showConfigHelp(); return; }
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  showNotice(error ? friendlyError(error) : 'If an account exists for this address, a password reset email is on its way.', !!error);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotice();
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  const name = document.querySelector('#name').value.trim();
  if (!emailOk(email)) { document.querySelector('#email-error').textContent = 'Enter a valid email address.'; emailInput.focus(); return; }
  if (!verifyingSignup && password.length < 8) { document.querySelector('#password-error').textContent = 'Use at least 8 characters.'; passwordInput.focus(); return; }
  if (registerMode && !name) { showNotice('Add your name so we know what to call you.', true); document.querySelector('#name').focus(); return; }
  if (!supabase) {
    enterDemoAwareness(registerMode ? name : undefined);
    return;
  }
  const submit = document.querySelector('#submit-button');
  submit.disabled = true;
  try {
    if (verifyingSignup) {
      const token = document.querySelector('#otp-code').value.trim();
      if (!/^\d{6}$/.test(token)) { document.querySelector('#otp-error').textContent = 'Enter the 6-digit code from your email.'; return; }
      const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      verifyingSignup = false;
      enterAwareness(data.user);
      return;
    }
    if (registerMode) {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
      if (error) throw error;
      if (data.session) { enterAwareness(data.user); return; }
      verifyingSignup = true;
      document.querySelector('#otp-field').hidden = false;
      document.querySelector('#submit-label').textContent = 'Verify email';
      showNotice('We sent a 6-digit verification code to your email. Enter it here to finish creating your account.');
      document.querySelector('#otp-code').focus();
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    enterAwareness(data.user);
  } catch (error) {
    showNotice(friendlyError(error), true);
  } finally { submit.disabled = false; }
});
document.querySelector('#resend-otp').addEventListener('click', async () => {
  if (!supabase) { showConfigHelp(); return; }
  const email = emailInput.value.trim().toLowerCase();
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  showNotice(error ? friendlyError(error) : 'A new verification code has been sent.', !!error);
});

function setDialog({ title, copy, fields = '', action, button = 'Continue' }) {
  currentAction = action;
  dialog.classList.toggle('admin-dialog', action === 'admin');
  dialogTitle.textContent = title;
  dialogCopy.textContent = copy;
  dialogFields.innerHTML = fields;
  dialogMessage.hidden = true;
  dialogMessage.classList.remove('error');
  dialogSubmit.innerHTML = `${button} <span>↗</span>`;
  dialog.showModal();
}
function inputField(label, id, placeholder, type = 'text') {
  return `<div class="dialog-field"><label for="${id}">${label}</label><input class="dialog-input" id="${id}" type="${type}" placeholder="${placeholder}"></div>`;
}
function areaField(label, id, placeholder) {
  return `<div class="dialog-field"><label for="${id}">${label}</label><textarea class="dialog-textarea" id="${id}" placeholder="${placeholder}"></textarea></div>`;
}
function selectField(label, id, options) {
  if (Array.isArray(id)) { options = id; id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  return `<div class="dialog-field"><label for="${id}">${label}</label><select class="dialog-select" id="${id}">${options.map((o) => `<option>${o}</option>`).join('')}</select></div>`;
}
function openAction(action) {
  const actions = {
    report: { title: 'Report a waste issue', copy: 'Help your neighborhood team find and fix a waste problem.', fields: `${selectField('Issue type', 'issue-type', ['Litter on the street', 'Overflowing bin', 'Illegal dumping', 'Other'])}${inputField('Location', 'issue-location', 'Street or nearby landmark')}${areaField('Add a note', 'issue-note', 'What did you notice?')}`, button: 'Submit report' },
    track: { title: 'Track your reports', copy: 'Your reports and the latest available status updates.', fields: '<div>Loading your reports…</div>', button: 'Close' },
    pickup: { title: 'Request a pickup', copy: 'Tell us what you need collected and choose a convenient day.', fields: `${selectField('Waste type', 'pickup-type', ['Dry recyclables', 'E-waste', 'Garden waste', 'Other'])}${inputField('Pickup location', 'pickup-location', 'Address or nearby landmark')}${inputField('Preferred date', 'pickup-date', '', 'date')}`, button: 'Request pickup' },
    hotspots: { title: 'Community hotspots', copy: 'Recent locations reported by CLEAN BUDDY members.', fields: '<div>Loading community hotspots…</div>', button: 'Close' },
    feedback: { title: 'Share your feedback', copy: 'Your ideas help us make CLEAN BUDDY better.', fields: `${selectField('How was your experience?', ['Great', 'Good', 'Could be better'])}${areaField('Your feedback', 'feedback-text', 'Tell us what you think...')}`, button: 'Send feedback' },
    reminder: { title: 'Set a reminder', copy: 'Give yourself a friendly nudge to keep your green habits going.', fields: `${inputField('Reminder', 'reminder-text', 'e.g. Put recycling out')}${inputField('Date', 'reminder-date', '', 'date')}${inputField('Time', 'reminder-time', '', 'time')}`, button: 'Save reminder' },
    admin: { title: 'Admin dashboard', copy: 'Community reports, pickup requests, and resident feedback.', fields: '<div class="dialog-message">Loading the community overview…</div>', button: 'Close' },
    scan: { title: 'Find the right bin', copy: 'Choose the item you want to dispose of for a sorting tip.', fields: `${selectField('What are you throwing away?', ['Plastic bottle', 'Paper or cardboard', 'Food scraps', 'Glass bottle or jar', 'Battery or e-waste', 'Other'])}<div class="dialog-message" id="scan-result" hidden></div>`, button: 'Check bin' },
    settings: demoMode
      ? { title: 'Your settings', copy: 'Make this dashboard feel like yours.', fields: `${inputField('Your name', 'demo-name', 'What should we call you?')}<div class="dialog-message">This prototype saves your activity in this browser.</div>`, button: 'Save settings' }
      : { title: 'Your settings', copy: 'Manage your CLEAN BUDDY account.', fields: '<div class="dialog-message">Your account and activity are stored securely with your signed-in account.</div>', button: 'Log out' }
  };
  setDialog({ ...actions[action], action });
  if (action === 'settings' && demoMode) document.querySelector('#demo-name').value = readDemoData().name || '';
  if (action === 'track') loadReports();
  if (action === 'hotspots') loadHotspots();
  if (action === 'admin') loadAdminDashboard();
}
document.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.section !== 'home') openAction(button.dataset.section);
}));
document.querySelector('#scan-button').addEventListener('click', () => openAction('scan'));
document.querySelector('#settings-button').addEventListener('click', () => openAction('settings'));
document.querySelector('#mobile-settings').addEventListener('click', () => openAction('settings'));
document.querySelectorAll('[data-enter-dashboard]').forEach((button) => button.addEventListener('click', showDashboard));

function safeText(value) {
  const span = document.createElement('span');
  span.textContent = value ?? '';
  return span.innerHTML;
}
async function refreshDashboard() {
  if (demoMode) {
    const data = readDemoData();
    const count = data.reports.length + data.pickups.length;
    document.querySelector('#impact-count').textContent = count;
    document.querySelector('#points-total').textContent = 120 + count * 10;
    return;
  }
  if (!supabase) return;
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  const [reports, pickups] = await Promise.all([
    supabase.from('reports').select('id', { count: 'exact', head: true }),
    supabase.from('pickup_requests').select('id', { count: 'exact', head: true })
  ]);
  if (!reports.error && !pickups.error) {
    const count = (reports.count || 0) + (pickups.count || 0);
    document.querySelector('#impact-count').textContent = count;
    document.querySelector('#points-total').textContent = 120 + count * 10;
  }
}
async function loadReports() {
  if (demoMode) {
    const reports = readDemoData().reports;
    dialogFields.innerHTML = reports.length ? reports.map((row) => `<div class="dialog-message"><b>#${safeText(row.reference)}</b> · ${safeText(row.location)}<br>${safeText(row.issue_type)} · <b>Status: ${safeText(row.status)}</b></div>`).join('') : '<div class="dialog-message">No reports yet. Submitted reports will appear here.</div>';
    return;
  }
  const { data, error } = await supabase.from('reports').select('reference, issue_type, location, status, created_at').order('created_at', { ascending: false }).limit(20);
  if (currentAction !== 'track') return;
  dialogFields.innerHTML = error ? `<div class="dialog-message error">${safeText(friendlyError(error))}</div>` : data.length ? data.map((row) => `<div class="dialog-message"><b>#${safeText(row.reference)}</b> · ${safeText(row.location)}<br>${safeText(row.issue_type)} · <b>Status: ${safeText(row.status)}</b></div>`).join('') : '<div class="dialog-message">No reports yet. Your submitted reports will appear here.</div>';
}
async function loadHotspots() {
  if (demoMode) {
    const reports = readDemoData().reports;
    const counts = reports.reduce((result, report) => {
      const location = report.location || 'Nearby';
      result[location] = (result[location] || 0) + 1;
      return result;
    }, {});
    dialogFields.innerHTML = Object.keys(counts).length ? Object.entries(counts).map(([location, count]) => `<div class="dialog-message">📍 ${safeText(location)} · ${count} recent report${count === 1 ? '' : 's'}</div>`).join('') : '<div class="dialog-message">No hotspots logged yet. Report an issue to help map community hotspots.</div>';
    return;
  }
  const { data, error } = await supabase.from('hotspots').select('location, report_count').limit(10);
  if (currentAction !== 'hotspots') return;
  dialogFields.innerHTML = error ? `<div class="dialog-message error">${safeText(friendlyError(error))}</div>` : data.length ? data.map((row) => `<div class="dialog-message">📍 ${safeText(row.location)} · ${row.report_count} recent reports</div>`).join('') : '<div class="dialog-message">No hotspots reported yet. Report a local issue to help the community.</div>';
}
function adminDate(value) {
  if (!value) return 'Date not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not set' : date.toLocaleDateString();
}
function adminList(title, rows, emptyText, rowMarkup) {
  const items = rows.length ? rows.map(rowMarkup).join('') : `<p class="admin-empty">${emptyText}</p>`;
  return `<section class="admin-list"><h3>${title}</h3>${items}</section>`;
}
function renderAdminDashboard({ reports, pickups, feedback, reportCount, openCount, pickupCount, feedbackCount }) {
  const metrics = [
    ['All reports', reportCount],
    ['Open reports', openCount],
    ['Pickup requests', pickupCount],
    ['Feedback', feedbackCount]
  ];
  const reportList = adminList('Recent reports', reports, 'No reports have been submitted.', (row) => `<article class="admin-record"><strong>#${safeText(row.reference || 'Report')} · ${safeText(row.issue_type)}</strong><span>${safeText(row.location)} · ${safeText(row.status)}</span><small>${adminDate(row.created_at)}</small></article>`);
  const pickupList = adminList('Recent pickups', pickups, 'No pickup requests have been submitted.', (row) => `<article class="admin-record"><strong>${safeText(row.waste_type)} pickup</strong><span>${safeText(row.location)} · ${safeText(row.status)}</span><small>${adminDate(row.preferred_date || row.created_at)}</small></article>`);
  const feedbackList = adminList('Recent feedback', feedback, 'No feedback has been submitted.', (row) => `<article class="admin-record"><strong>${safeText(row.rating)}</strong><span>${safeText(row.message)}</span><small>${adminDate(row.created_at)}</small></article>`);
  dialogFields.innerHTML = `<div class="admin-metrics">${metrics.map(([label, count]) => `<div class="admin-metric"><span>${label}</span><strong>${count}</strong></div>`).join('')}</div><div class="admin-lists">${reportList}${pickupList}${feedbackList}</div>`;
}
async function loadAdminDashboard() {
  if (demoMode) {
    const data = readDemoData();
    const reports = data.reports || [];
    const pickups = data.pickups || [];
    const feedback = data.feedback || [];
    renderAdminDashboard({
      reports: reports.slice(0, 5), pickups: pickups.slice(0, 5), feedback: feedback.slice(0, 5),
      reportCount: reports.length, openCount: reports.filter((row) => row.status !== 'Resolved').length,
      pickupCount: pickups.length, feedbackCount: feedback.length
    });
    return;
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (currentAction !== 'admin') return;
  if (userError || !user || user.app_metadata?.role !== 'admin') {
    dialogFields.innerHTML = '<div class="dialog-message error">Admin access is required. Ask your project administrator to assign the admin role to your account.</div>';
    return;
  }
  const [reportsResult, pickupsResult, feedbackResult, reportsCount, openCount, pickupsCount, feedbackCount] = await Promise.all([
    supabase.from('reports').select('reference, issue_type, location, status, created_at').order('created_at', { ascending: false }).limit(5),
    supabase.from('pickup_requests').select('waste_type, location, preferred_date, status, created_at').order('created_at', { ascending: false }).limit(5),
    supabase.from('feedback').select('rating, message, created_at').order('created_at', { ascending: false }).limit(5),
    supabase.from('reports').select('id', { count: 'exact', head: true }),
    supabase.from('reports').select('id', { count: 'exact', head: true }).neq('status', 'Resolved'),
    supabase.from('pickup_requests').select('id', { count: 'exact', head: true }),
    supabase.from('feedback').select('id', { count: 'exact', head: true })
  ]);
  if (currentAction !== 'admin') return;
  const error = reportsResult.error || pickupsResult.error || feedbackResult.error || reportsCount.error || openCount.error || pickupsCount.error || feedbackCount.error;
  if (error) {
    dialogFields.innerHTML = `<div class="dialog-message error">${safeText(friendlyError(error))} Run the latest admin policies from supabase-setup.sql.</div>`;
    return;
  }
  renderAdminDashboard({
    reports: reportsResult.data || [], pickups: pickupsResult.data || [], feedback: feedbackResult.data || [],
    reportCount: reportsCount.count || 0, openCount: openCount.count || 0,
    pickupCount: pickupsCount.count || 0, feedbackCount: feedbackCount.count || 0
  });
}
function resultMessage(message, isError = false) {
  dialogMessage.textContent = message;
  dialogMessage.classList.toggle('error', isError);
  dialogMessage.hidden = false;
}
dialogSubmit.addEventListener('click', async () => {
  if (currentAction === 'done') { dialog.close(); return; }
  if (currentAction === 'scan') {
    const selected = dialogFields.querySelector('select')?.value || 'Other';
    const bins = { 'Plastic bottle': '♻ Blue or recycling bin — empty and rinse it first.', 'Paper or cardboard': '📄 Blue or recycling bin — keep it clean and dry.', 'Food scraps': '🌱 Green or compost bin.', 'Glass bottle or jar': '🫙 Glass recycling bin — check local collection rules.', 'Battery or e-waste': '🔋 Special e-waste drop-off — never put it in a regular bin.', Other: '🗑 Check the label on your local bins or ask your waste team.' };
    const result = dialogFields.querySelector('#scan-result');
    result.textContent = bins[selected];
    result.hidden = false;
    dialogSubmit.innerHTML = 'Got it <span>✓</span>';
    return;
  }
  if (currentAction === 'settings') {
    if (demoMode) {
      const data = readDemoData();
      const name = document.querySelector('#demo-name').value.trim();
      if (!name) { resultMessage('Add your name before saving.', true); return; }
      data.name = name;
      writeDemoData(data);
      document.querySelector('#user-name').textContent = name;
      document.querySelector('#user-avatar').textContent = name[0].toUpperCase();
      resultMessage('Your settings are saved.');
      dialogSubmit.innerHTML = 'Done <span>✓</span>';
      currentAction = 'done';
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) { resultMessage(friendlyError(error), true); return; }
    dialog.close();
    appView.hidden = true;
    awarenessView.hidden = true;
    activeUserId = null;
    authView.hidden = false;
    form.reset();
    if (registerMode) document.querySelector('#register-toggle').click();
    document.querySelector('#otp-field').hidden = true;
    verifyingSignup = false;
    return;
  }
  if (currentAction === 'track' || currentAction === 'hotspots' || currentAction === 'admin') { dialog.close(); return; }
  if (demoMode) {
    const data = readDemoData();
    const reference = `CB-${String(Date.now()).slice(-6)}`;
    if (currentAction === 'report') {
      const location = document.querySelector('#issue-location').value.trim();
      if (!location) { resultMessage('Add a location so the team knows where to go.', true); return; }
      data.reports.unshift({ reference, issue_type: document.querySelector('#issue-type').value, location, status: 'Received', created_at: new Date().toISOString() });
    } else if (currentAction === 'pickup') {
      const location = document.querySelector('#pickup-location').value.trim();
      if (!location) { resultMessage('Add a pickup location to continue.', true); return; }
      data.pickups.unshift({ reference, waste_type: document.querySelector('#pickup-type').value, location, preferred_date: document.querySelector('#pickup-date').value, status: 'Requested', created_at: new Date().toISOString() });
    } else if (currentAction === 'feedback') {
      const message = document.querySelector('#feedback-text').value.trim();
      if (!message) { resultMessage('Add a little feedback before sending.', true); return; }
      data.feedback.unshift({ message, rating: document.querySelector('#how-was-your-experience-').value, created_at: new Date().toISOString() });
    } else if (currentAction === 'reminder') {
      const title = document.querySelector('#reminder-text').value.trim();
      if (!title) { resultMessage('Give your reminder a name first.', true); return; }
      data.reminders.unshift({ title, date: document.querySelector('#reminder-date').value, time: document.querySelector('#reminder-time').value });
    }
    writeDemoData(data);
    const messages = { report: 'Your report is saved in this prototype.', pickup: 'Your pickup request is saved.', feedback: 'Thanks for sharing your thoughts!', reminder: 'Your reminder is saved.' };
    dialogFields.innerHTML = '';
    dialogCopy.textContent = messages[currentAction] || 'Saved.';
    dialogMessage.hidden = true;
    dialogSubmit.innerHTML = 'Done <span>✓</span>';
    currentAction = 'done';
    await refreshDashboard();
    return;
  }
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) { resultMessage('Your session has expired. Please log in again.', true); return; }
  let table;
  let row;
  if (currentAction === 'report') {
    const location = document.querySelector('#issue-location').value.trim();
    if (!location) { resultMessage('Add a location so the team knows where to go.', true); return; }
    table = 'reports';
    row = { user_id: user.id, issue_type: document.querySelector('#issue-type').value, location, note: document.querySelector('#issue-note').value.trim() };
  } else if (currentAction === 'pickup') {
    const location = document.querySelector('#pickup-location').value.trim();
    if (!location) { resultMessage('Add a pickup location to continue.', true); return; }
    table = 'pickup_requests';
    row = { user_id: user.id, waste_type: document.querySelector('#pickup-type').value, location, preferred_date: document.querySelector('#pickup-date').value || null };
  } else if (currentAction === 'feedback') {
    const message = document.querySelector('#feedback-text').value.trim();
    if (!message) { resultMessage('Add a little feedback before sending.', true); return; }
    table = 'feedback';
    row = { user_id: user.id, rating: document.querySelector('#how-was-your-experience-').value, message };
  } else if (currentAction === 'reminder') {
    const title = document.querySelector('#reminder-text').value.trim();
    if (!title) { resultMessage('Give your reminder a name first.', true); return; }
    table = 'reminders';
    row = { user_id: user.id, title, remind_at: document.querySelector('#reminder-date').value ? new Date(`${document.querySelector('#reminder-date').value}T${document.querySelector('#reminder-time').value || '09:00'}:00`).toISOString() : null };
  }
  const { error } = await supabase.from(table).insert(row);
  if (error) { resultMessage(friendlyError(error), true); return; }
  const messages = { report: 'Thanks! Your report has been saved.', pickup: 'Your pickup request has been saved.', feedback: 'Thanks for sharing your thoughts!', reminder: 'Your reminder has been saved.' };
  dialogFields.innerHTML = '';
  dialogCopy.textContent = messages[currentAction] || 'Saved.';
  dialogMessage.hidden = true;
  dialogSubmit.innerHTML = 'Done <span>✓</span>';
  currentAction = 'done';
  await refreshDashboard();
});

supabase?.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    appView.hidden = true;
    awarenessView.hidden = true;
    activeUserId = null;
    authView.hidden = false;
  } else if (event === 'SIGNED_IN' && session?.user && session.user.id !== activeUserId) {
    queueMicrotask(() => {
      if (session.user.id !== activeUserId) enterAwareness(session.user);
    });
  }
});
if (supabase) {
  supabase.auth.getSession().then(({ data: { session } }) => { if (session?.user) enterAwareness(session.user); });
}