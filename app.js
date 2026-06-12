(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- API ---------- */
  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch('/api/' + path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    }, opts));
    var data = {};
    try { data = await res.json(); } catch (e) {}
    return { status: res.status, ok: res.ok, data: data };
  }

  /* ---------- helpers ---------- */
  var MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  var WDAYS = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); }
  function initials(name) { var p = String(name).trim().split(/\s+/); return ((p[0]||'')[0]||'').toUpperCase() + ((p[1]||'')[0]||'').toUpperCase(); }
  function toMin(h) { if (!h) return 0; var p = h.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function fmtDur(m) { if (m == null) return '—'; if (m < 0) m = 0; return Math.floor(m/60) + 'ч ' + (m%60<10?'0':'') + (m%60) + 'м'; }
  function workedMin(r) { if (!r.in || !r.out) return null; var d = toMin(r.out) - toMin(r.in); if (d < 0) d += 1440; return d; }
  function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }

  /* ---------- device fingerprint (client) ---------- */
  function cyrb53(str, seed) { seed = seed || 0; var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0); }
  var _dev = null;
  async function gatherDevice() {
    if (_dev) return _dev;
    var ua = navigator.userAgent || '', model = '', os = 'ПК', br = '';
    if (/iPhone/.test(ua)) os = 'iPhone'; else if (/iPad/.test(ua)) os = 'iPad';
    else if (/Android/.test(ua)) os = 'Android'; else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac/.test(ua)) os = 'Mac'; else if (/Linux/.test(ua)) os = 'Linux';
    if (/Edg\//.test(ua)) br = 'Edge'; else if (/OPR\//.test(ua)) br = 'Opera';
    else if (/Chrome\//.test(ua)) br = 'Chrome'; else if (/Firefox\//.test(ua)) br = 'Firefox'; else if (/Safari\//.test(ua)) br = 'Safari';
    var m = ua.match(/;\s?([^;)]+?)\s+Build\//); if (m) model = m[1].trim();
    try { if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) { var h = await navigator.userAgentData.getHighEntropyValues(['model']); if (h && h.model) model = h.model; } } catch (e) {}
    var label = [os, model, br].filter(Boolean).join(' · ') || 'Неизвестное устройство';
    var scr = (screen.width||0) + 'x' + (screen.height||0);
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var id = 'd' + cyrb53(ua + '|' + (navigator.platform||'') + '|' + scr + '|' + model + '|' + tz, 0x9e37).toString(16);
    _dev = { id: id, label: label };
    return _dev;
  }

  /* ---------- session ---------- */
  var currentUser = null;

  async function boot() {
    var r = await api('me');
    if (r.ok && r.data.user) { currentUser = r.data.user; enterApp(); }
    else { showLogin(); }
    setInterval(clock, 1000);
  }
  function showLogin() {
    currentUser = null;
    $('appShell').style.display = 'none';
    $('login').style.display = 'flex';
    $('loginIin').focus();
  }

  $('loginBtn').addEventListener('click', doLogin);
  $('loginPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  async function doLogin() {
    var btn = $('loginBtn');
    $('loginErr').textContent = ''; $('loginErr').style.color = 'var(--red)';
    var iin = $('loginIin').value.trim(), pass = $('loginPass').value;
    if (!/^\d{12}$/.test(iin)) { $('loginErr').textContent = 'ИИН должен состоять из 12 цифр.'; return; }
    if (!pass) { $('loginErr').textContent = 'Введите пароль.'; return; }
    btn.disabled = true; btn.textContent = 'Вход…';
    try {
      var r = await api('login', { method: 'POST', body: JSON.stringify({ iin: iin, password: pass }) });
      if (r.ok && r.data.user) { currentUser = r.data.user; $('loginPass').value = ''; enterApp(); }
      else { $('loginErr').textContent = r.data.error || 'Не удалось войти.'; }
    } catch (e) { $('loginErr').textContent = 'Сбой сети.'; }
    finally { btn.disabled = false; btn.textContent = 'Войти'; }
  }

  $('logoutBtn').addEventListener('click', async function () {
    stopScanner(); stopStation();
    await api('logout', { method: 'POST' });
    showLogin();
  });

  function enterApp() {
    $('login').style.display = 'none';
    $('appShell').style.display = 'flex';
    $('hdrName').textContent = currentUser.fio;
    var isAdmin = currentUser.role === 'admin';
    $('hdrRole').innerHTML = '<span class="badge ' + (isAdmin?'admin':'emp') + '">' + (isAdmin?'Администратор':'Сотрудник') + '</span> ' + currentUser.iin;
    var role = isAdmin ? 'admin' : 'employee', first = null;
    document.querySelectorAll('#nav button').forEach(function (b) {
      var ok = b.dataset.role === role; b.style.display = ok ? 'block' : 'none';
      if (ok && !first) first = b.dataset.view;
    });
    $('ciWho').textContent = currentUser.fio + ' · ' + currentUser.iin;
    switchView(first, true);
  }

  /* ---------- navigation ---------- */
  var current = null;
  document.querySelectorAll('#nav button').forEach(function (btn) { btn.addEventListener('click', function () { switchView(btn.dataset.view); }); });
  function switchView(name, force) {
    if (name === current && !force) return;
    if (current === 'checkin') stopScanner();
    if (current === 'station') stopStation();
    current = name;
    document.querySelectorAll('#nav button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.view === name ? 'true' : 'false'); });
    ['station','employees','journal','checkin'].forEach(function (k) { $('view-'+k).classList.toggle('active', k === name); });
    if (name === 'station') startStation();
    if (name === 'employees') renderEmployees();
    if (name === 'journal') { defaultPeriod(); renderJournal(); }
    if (name === 'checkin') { hideResult(); refreshCheckinStatus(); }
  }

  function clock() { var n = new Date(); $('liveClock').textContent = pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds()); }

  /* ---------- station ---------- */
  var stationTimer = null, lastPayload = null;
  function startStation() { refreshQR(); stationTimer = setInterval(refreshQR, 10000); }
  function stopStation() { if (stationTimer) { clearInterval(stationTimer); stationTimer = null; } lastPayload = null; }
  async function refreshQR() {
    var r = await api('qr');
    if (r.status === 401) { showLogin(); return; }
    if (!r.ok) return;
    var d = r.data, now = new Date();
    $('stationMonth').textContent = WDAYS[now.getDay()].toUpperCase();
    $('stationDay').textContent = d.date;
    $('codeText').textContent = d.code;
    $('slotTime').textContent = d.time;
    if (d.payload !== lastPayload) {
      lastPayload = d.payload;
      var holder = $('qr'); holder.innerHTML = '';
      if (typeof QRCode !== 'undefined') new QRCode(holder, { text: d.payload, width: 220, height: 220, colorDark: '#13161C', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    }
  }

  /* ---------- employees ---------- */
  var editingIin = null;
  $('shiftSaveBtn').addEventListener('click', async function () {
    var b = this; b.disabled = true;
    var r = await api('settings', { method: 'POST', body: JSON.stringify({ shiftStart: $('shiftStart').value, tz: $('tzInput').value.trim() }) });
    b.textContent = r.ok ? 'Сохранено ✓' : 'Ошибка'; setTimeout(function(){ b.textContent='Сохранить'; b.disabled=false; }, 1200);
  });
  $('empSaveBtn').addEventListener('click', saveEmployee);
  async function saveEmployee() {
    $('empErr').textContent = '';
    var iin = $('empIin').value.trim(), fio = $('empFio').value.trim(), pass = $('empPass').value, role = $('empRole').value;
    if (!/^\d{12}$/.test(iin)) { $('empErr').textContent = 'ИИН должен состоять из 12 цифр.'; return; }
    if (fio.length < 3) { $('empErr').textContent = 'Укажите ФИО.'; return; }
    var r = await api('employees', { method: 'POST', body: JSON.stringify({ action: 'upsert', iin: iin, fio: fio, password: pass, role: role }) });
    if (!r.ok) { $('empErr').textContent = r.data.error || 'Ошибка сохранения.'; return; }
    $('empIin').value = ''; $('empFio').value = ''; $('empPass').value = ''; $('empRole').value = 'employee';
    editingIin = null; $('empSaveBtn').textContent = 'Сохранить сотрудника';
    renderEmployees();
  }
  async function renderEmployees() {
    var sr = await api('settings');
    if (sr.status === 401) { showLogin(); return; }
    if (sr.ok) { $('shiftStart').value = sr.data.shiftStart || '09:00'; $('tzInput').value = sr.data.tz || ''; }
    var r = await api('employees');
    if (!r.ok) return;
    var emps = (r.data.employees || []).slice().sort(function (a, b) { return a.fio.localeCompare(b.fio, 'ru'); });
    $('empCount').textContent = emps.length ? emps.length + ' чел.' : '';
    var list = $('empList');
    if (!emps.length) { list.innerHTML = '<div class="empty"><div class="big">👥</div>Список пуст. Добавьте сотрудников выше.</div>'; return; }
    list.innerHTML = emps.map(function (e) {
      var badge = e.role === 'admin' ? '<span class="badge admin">админ</span>' : '';
      var dev = e.bound ? ('📱 ' + esc(e.deviceLabel || 'устройство закреплено')) : '📱 не закреплено';
      var reset = e.bound ? '<button class="iconbtn" data-resetdev="' + e.iin + '" title="Сбросить устройство">⟲</button>' : '';
      return '<div class="rec"><div class="avatar">' + initials(e.fio) + '</div>' +
        '<div class="info"><div class="n">' + esc(e.fio) + ' ' + badge + '</div><div class="d">' + e.iin + '</div><div class="d2">' + dev + '</div></div>' +
        '<div class="acts">' + reset + '<button class="iconbtn" data-edit="' + e.iin + '" title="Изменить">✎</button>' +
        '<button class="iconbtn danger" data-del="' + e.iin + '" title="Удалить">✕</button></div></div>';
    }).join('');
    list.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { startEdit(b.dataset.edit, emps); }); });
    list.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { delEmployee(b.dataset.del); }); });
    list.querySelectorAll('[data-resetdev]').forEach(function (b) { b.addEventListener('click', function () { resetDevice(b.dataset.resetdev); }); });
  }
  function startEdit(iin, emps) {
    var e = emps.find(function (x) { return x.iin === iin; }); if (!e) return;
    $('empIin').value = e.iin; $('empFio').value = e.fio; $('empPass').value = ''; $('empRole').value = e.role;
    editingIin = iin; $('empSaveBtn').textContent = 'Обновить сотрудника';
    $('view-employees').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function delEmployee(iin) {
    if (!confirm('Удалить сотрудника ' + iin + '?')) return;
    var r = await api('employees', { method: 'POST', body: JSON.stringify({ action: 'delete', iin: iin }) });
    if (!r.ok) { alert(r.data.error || 'Ошибка'); return; }
    renderEmployees();
  }
  async function resetDevice(iin) {
    if (!confirm('Сбросить закреплённое устройство? Следующая отметка закрепит новое.')) return;
    await api('employees', { method: 'POST', body: JSON.stringify({ action: 'reset-device', iin: iin }) });
    renderEmployees();
  }

  /* ---------- check-in ---------- */
  var scanner = null, scanning = false, busy = false;
  function setStatus(m) { $('scanStatus').textContent = m || ''; }
  async function refreshCheckinStatus() {
    var r = await api('checkin');
    if (r.status === 401) { showLogin(); return; }
    var el = $('ciStatus');
    if (r.ok) {
      var rec = r.data.today, shift = r.data.shiftStart;
      if (!rec) { el.className = 'ci-status'; el.textContent = 'Сегодня ещё не отмечались. Сканирование зафиксирует приход (смена с ' + shift + ').'; }
      else if (!rec.out) { el.className = 'ci-status'; el.innerHTML = 'Приход: <b>' + rec.in + '</b>' + (rec.lateMin > 0 ? (' · опоздание ' + rec.lateMin + ' мин') : ' · вовремя') + '. Следующее сканирование — уход.'; }
      else { el.className = 'ci-status done'; el.innerHTML = 'Приход: <b>' + rec.in + '</b> · Уход: <b>' + rec.out + '</b> · отработано ' + fmtDur(workedMin(rec)) + '. День закрыт.'; }
    }
    gatherDevice().then(function (d) { $('ciDevice').textContent = 'Устройство: ' + d.label; });
  }

  $('scanBtn').addEventListener('click', startScanner);
  $('stopBtn').addEventListener('click', stopScanner);
  async function startScanner() {
    if (typeof Html5Qrcode === 'undefined') { setStatus('Сканер не загрузился. Используйте «Загрузить фото QR».'); return; }
    hideResult();
    try {
      scanner = scanner || new Html5Qrcode('reader'); scanning = true;
      $('scanBtn').style.display = 'none'; $('stopBtn').style.display = 'block';
      setStatus('Наведите камеру на QR-код…');
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, function (d) { onDecoded(d); }, function () {});
    } catch (e) {
      scanning = false; $('scanBtn').style.display = 'block'; $('stopBtn').style.display = 'none';
      setStatus('Камера недоступна. Нажмите «Загрузить фото QR».');
    }
  }
  async function stopScanner() {
    if (scanner && scanning) { try { await scanner.stop(); } catch (e) {} try { scanner.clear(); } catch (e) {} }
    scanning = false; $('scanBtn').style.display = 'block'; $('stopBtn').style.display = 'none';
    if (!$('result').classList.contains('show')) setStatus('');
  }
  $('uploadBtn').addEventListener('click', function () { $('fileInput').click(); });
  $('fileInput').addEventListener('change', async function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    if (typeof Html5Qrcode === 'undefined') { setStatus('Сканер не загрузился.'); return; }
    setStatus('Распознаём код на фото…');
    var temp = new Html5Qrcode('reader');
    try { var d = await temp.scanFile(f, false); onDecoded(d); }
    catch (err) { setStatus('На фото не найден QR-код.'); }
    finally { try { temp.clear(); } catch (e) {} $('fileInput').value = ''; }
  });

  async function onDecoded(text) {
    if (busy) return; busy = true;
    await stopScanner();
    var dev = await gatherDevice();
    var r = await api('checkin', { method: 'POST', body: JSON.stringify({ code: text, deviceId: dev.id, deviceLabel: dev.label }) });
    if (r.status === 401) { showLogin(); busy = false; return; }
    var d = r.data || {};
    showResult(d.kind || 'err', d.title || 'Ошибка', d.meta || '', d.note || '');
    await refreshCheckinStatus();
    busy = false;
  }
  function showResult(kind, who, meta, note) {
    var el = $('result'); el.className = 'result show ' + kind;
    $('resultMark').textContent = kind === 'ok' ? '✓' : (kind === 'warn' ? '!' : '✕');
    $('resultWho').textContent = who; $('resultMeta').textContent = meta || ''; $('resultNote').textContent = note || ''; setStatus('');
  }
  function hideResult() { $('result').className = 'result'; }

  /* ---------- journal ---------- */
  function defaultPeriod() {
    var now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), 1);
    if (!$('fromDate').value) $('fromDate').value = todayStr(first);
    if (!$('toDate').value) $('toDate').value = todayStr(now);
  }
  ['fromDate','toDate','search'].forEach(function (id) { $(id).addEventListener('input', renderJournal); });
  var lastRows = [];
  async function renderJournal() {
    var qs = 'from=' + encodeURIComponent($('fromDate').value) + '&to=' + encodeURIComponent($('toDate').value) + '&q=' + encodeURIComponent($('search').value.trim());
    var r = await api('journal?' + qs);
    if (r.status === 401) { showLogin(); return; }
    if (!r.ok) return;
    var rows = r.data.records || []; lastRows = rows;
    $('journalCount').textContent = r.data.total ? (r.data.count + ' / ' + r.data.total) : '';
    var list = $('journalList');
    if (!rows.length) { list.innerHTML = '<div class="empty"><div class="big">🗂️</div>' + (r.data.total ? 'За выбранный период отметок нет.' : 'Отметок пока нет.') + '</div>'; return; }
    list.innerHTML = rows.map(function (rr) {
      var late = rr.late ? '<span class="badge late">+' + rr.lateMin + 'м</span>' : '';
      var devLine = (rr.device || rr.ip) ? ('<div class="d2">📱 ' + esc(rr.device || '—') + ' · IP ' + esc(rr.ip || '—') + '</div>') : '';
      return '<div class="rec"><div class="avatar">' + initials(rr.fio) + '</div>' +
        '<div class="info"><div class="n">' + esc(rr.fio) + ' ' + late + '</div><div class="d">' + rr.iin + ' · ' + rr.date + '</div>' + devLine + '</div>' +
        '<div class="jtimes"><div><span>приход</span>' + rr.in + '</div><div><span>уход</span>' + (rr.out||'—') + '</div><div class="jw">' + fmtDur(workedMin(rr)) + '</div></div></div>';
    }).join('');
  }
  function periodLabel() { return 'Период: ' + ($('fromDate').value || '…') + ' — ' + ($('toDate').value || '…'); }
  function downloadBlob(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  $('csvBtn').addEventListener('click', function () {
    var rows = lastRows.slice().sort(function (a, b) { return a.ts - b.ts; });
    var data = [['№','ФИО','ИИН','Дата','Приход','Уход','Часы','Опоздание, мин','Устройство','IP']]
      .concat(rows.map(function (r, i) { return [i+1, r.fio, r.iin, r.date, r.in, r.out||'', fmtDur(workedMin(r)), r.lateMin||0, r.device||'', r.ip||'']; }));
    var csv = data.map(function (row) { return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), 'prihod-' + $('fromDate').value + '_' + $('toDate').value + '.csv');
  });
  $('pdfBtn').addEventListener('click', function () {
    var rows = lastRows.slice().sort(function (a, b) { return a.ts - b.ts; });
    if (!rows.length) { alert('За выбранный период нет отметок.'); return; }
    if (typeof pdfMake === 'undefined') { alert('Модуль PDF не загрузился.'); return; }
    var now = new Date(), lateCount = rows.filter(function (r) { return r.late; }).length;
    var body = [['№','ФИО','ИИН','Дата','Приход','Уход','Часы','Опозд.','Устройство','IP'].map(function (h) { return { text: h, style: 'th' }; })];
    rows.forEach(function (r, i) { body.push([
      { text: String(i+1) }, { text: r.fio }, { text: r.iin }, { text: r.date },
      { text: r.in||'—' }, { text: r.out||'—' }, { text: fmtDur(workedMin(r)) },
      { text: r.lateMin ? (r.lateMin + 'м') : '—', color: r.late ? '#c0392b' : '#000' },
      { text: r.device||'—', fontSize: 8 }, { text: r.ip||'—', fontSize: 8 },
    ]); });
    var dd = {
      pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [24, 50, 24, 40],
      content: [
        { text: 'Отчёт по приходу сотрудников', fontSize: 15, bold: true, margin: [0,0,0,3] },
        { text: periodLabel(), fontSize: 10, color: '#666' },
        { text: 'Всего отметок: ' + rows.length + '   ·   Опозданий: ' + lateCount + '   ·   Сформировано: ' + todayStr(now) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()), fontSize: 9, color: '#888', margin: [0,1,0,12] },
        { table: { headerRows: 1, widths: [16,120,68,52,38,38,42,34,'*',70], body: body }, layout: 'lightHorizontalLines' },
      ],
      styles: { th: { bold: true, fillColor: '#f0f0f0', fontSize: 9 } },
      defaultStyle: { fontSize: 9 },
      footer: function (cur, total) { return { text: cur + ' / ' + total, alignment: 'center', fontSize: 8, color: '#999', margin: [0,6,0,0] }; },
    };
    pdfMake.createPdf(dd).download('prihod-' + $('fromDate').value + '_' + $('toDate').value + '.pdf');
  });

  boot();
})();
