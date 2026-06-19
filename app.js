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
  function deviceUID() {
    try {
      var k = 'att_device_uid';
      var v = localStorage.getItem(k);
      if (!v) { v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)); localStorage.setItem(k, v); }
      return v;
    } catch (e) { return ''; }
  }
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
    if (r.ok && r.data.user) { currentUser = r.data.user; afterAuth(); }
    else { showLogin(); }
    setInterval(clock, 1000);
  }
  function showLogin() {
    currentUser = null;
    $('appShell').style.display = 'none';
    $('changepw').style.display = 'none';
    $('login').style.display = 'flex';
    $('loginIin').focus();
  }
  function afterAuth() {
    if (currentUser && currentUser.mustChange) {
      $('login').style.display = 'none';
      $('appShell').style.display = 'none';
      $('changepw').style.display = 'flex';
      $('np1').focus();
    } else { enterApp(); }
  }

  // ---- геолокация (с разрешения) ----
  function getGeo() {
    return new Promise(function (res) {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        function (p) { res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }); },
        function () { res(null); },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
      );
    });
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
      var dev = await gatherDevice();
      var geo = await getGeo();
      var r = await api('login', { method: 'POST', body: JSON.stringify({ iin: iin, password: pass, uid: deviceUID(), deviceLabel: dev.label, geo: geo }) });
      if (r.ok && r.data.user) { currentUser = r.data.user; $('loginPass').value = ''; afterAuth(); }
      else { $('loginErr').textContent = r.data.error || 'Не удалось войти.'; }
    } catch (e) { $('loginErr').textContent = 'Сбой сети.'; }
    finally { btn.disabled = false; btn.textContent = 'Войти'; }
  }

  $('npBtn').addEventListener('click', async function () {
    $('npErr').textContent = '';
    var a = $('np1').value, b = $('np2').value;
    if (!a || a.length < 6) { $('npErr').textContent = 'Пароль не короче 6 символов.'; return; }
    if (a !== b) { $('npErr').textContent = 'Пароли не совпадают.'; return; }
    this.disabled = true; this.textContent = 'Сохранение…';
    try {
      var r = await api('change-password', { method: 'POST', body: JSON.stringify({ newPassword: a }) });
      if (r.ok) { currentUser.mustChange = false; $('np1').value = ''; $('np2').value = ''; $('changepw').style.display = 'none'; enterApp(); }
      else { $('npErr').textContent = (r.data && r.data.error) || 'Ошибка.'; }
    } catch (e) { $('npErr').textContent = 'Сбой сети.'; }
    finally { this.disabled = false; this.textContent = 'Сохранить пароль'; }
  });

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
  $('useHereBtn') && $('useHereBtn').addEventListener('click', async function () {
    var btn = this; btn.disabled = true; btn.textContent = 'Определяем…';
    var g = await getGeo();
    btn.disabled = false; btn.textContent = 'Взять текущее место';
    if (g) { $('officeLat').value = g.lat; $('officeLng').value = g.lng; $('officeMsg').style.color = 'var(--green)'; $('officeMsg').textContent = 'Координаты подставлены — нажмите «Сохранить офис».'; }
    else { $('officeMsg').style.color = 'var(--red)'; $('officeMsg').textContent = 'Не удалось получить местоположение (разрешите геолокацию).'; }
  });
  $('officeSaveBtn') && $('officeSaveBtn').addEventListener('click', async function () {
    var lat = $('officeLat').value.trim(), lng = $('officeLng').value.trim(), radius = $('radiusInput').value.trim() || 200;
    var body = (lat === '' && lng === '') ? { officeLat: null, radius: radius } : { officeLat: lat, officeLng: lng, radius: radius };
    var r = await api('settings', { method: 'POST', body: JSON.stringify(body) });
    $('officeMsg').style.color = r.ok ? 'var(--green)' : 'var(--red)';
    $('officeMsg').textContent = r.ok ? 'Офис сохранён.' : ((r.data && r.data.error) || 'Ошибка.');
  });
  async function saveEmployee() {
    $('empErr').textContent = '';
    var company = $('empCompany').value.trim(), iin = $('empIin').value.trim(), fio = $('empFio').value.trim(), pass = $('empPass').value, role = $('empRole').value;
    if (!/^\d{12}$/.test(iin)) { $('empErr').textContent = 'ИИН должен состоять из 12 цифр.'; return; }
    if (fio.length < 3) { $('empErr').textContent = 'Укажите ФИО.'; return; }
    var r = await api('employees', { method: 'POST', body: JSON.stringify({ action: 'upsert', iin: iin, fio: fio, password: pass, role: role, company: company }) });
    if (!r.ok) { $('empErr').textContent = r.data.error || 'Ошибка сохранения.'; return; }
    $('empCompany').value = ''; $('empIin').value = ''; $('empFio').value = ''; $('empPass').value = ''; $('empRole').value = 'employee';
    editingIin = null; $('empSaveBtn').textContent = 'Сохранить сотрудника';
    renderEmployees();
  }
  $('bulkBtn').addEventListener('click', bulkImport);
  async function bulkImport() {
    var msg = $('bulkMsg'); msg.style.color = 'var(--muted)'; msg.textContent = '';
    var text = $('bulkText').value.trim();
    if (!text) { msg.textContent = 'Вставьте список.'; return; }
    var rows = [];
    text.split(/\r?\n/).forEach(function (line) {
      line = line.trim(); if (!line) return;
      var parts = line.split(/[;\t]/).map(function (x) { return x.trim(); });
      if (parts.length < 4 && line.indexOf(';') < 0) parts = line.split(','); // запасной разделитель
      rows.push({ company: parts[0] || '', iin: parts[1] || '', fio: parts[2] || '', password: parts[3] || '' });
    });
    // пропускаем строку-заголовок, если она есть
    if (rows.length && !/^\d{12}$/.test(rows[0].iin) && /иин|iin/i.test(rows[0].iin + rows[0].fio + rows[0].company)) rows.shift();
    $('bulkBtn').disabled = true; $('bulkBtn').textContent = 'Импорт…';
    var r = await api('employees', { method: 'POST', body: JSON.stringify({ action: 'import', rows: rows }) });
    $('bulkBtn').disabled = false; $('bulkBtn').textContent = 'Импортировать список';
    if (!r.ok) { msg.style.color = 'var(--red)'; msg.textContent = r.data.error || 'Ошибка импорта.'; return; }
    var d = r.data;
    msg.style.color = (d.errors && d.errors.length) ? 'var(--red)' : 'var(--green)';
    msg.innerHTML = 'Добавлено: ' + d.added + ', обновлено: ' + d.updated + (d.errors && d.errors.length ? ('<br>Пропущено ' + d.errors.length + ':<br>' + d.errors.map(esc).join('<br>')) : '');
    if (!(d.errors && d.errors.length)) $('bulkText').value = '';
    renderEmployees();
  }
  async function renderEmployees() {
    var sr = await api('settings');
    if (sr.status === 401) { showLogin(); return; }
    if (sr.ok) {
      $('shiftStart').value = sr.data.shiftStart || '09:00';
      $('tzInput').value = sr.data.tz || '';
      $('officeLat').value = sr.data.officeLat != null ? sr.data.officeLat : '';
      $('officeLng').value = sr.data.officeLng != null ? sr.data.officeLng : '';
      $('radiusInput').value = sr.data.radius || 200;
    }
    var r = await api('employees');
    if (!r.ok) return;
    var emps = (r.data.employees || []).slice().sort(function (a, b) { return a.fio.localeCompare(b.fio, 'ru'); });
    $('empCount').textContent = emps.length ? emps.length + ' чел.' : '';
    var list = $('empList');
    if (!emps.length) { list.innerHTML = '<div class="empty"><div class="big">👥</div>Список пуст. Добавьте сотрудников выше.</div>'; return; }
    list.innerHTML = emps.map(function (e) {
      var badge = e.role === 'admin' ? '<span class="badge admin">админ</span>' : '';
      var dev = e.bound ? ('📱 ' + esc(e.deviceLabel || 'устройство закреплено')) : '📱 не закреплено';
      var login = e.lastDevice ? (' · вход: ' + esc(e.lastDevice)) : '';
      var comp = e.company ? (esc(e.company) + ' · ') : '';
      var reset = e.bound ? '<button class="iconbtn" data-resetdev="' + e.iin + '" title="Сбросить устройство">⟲</button>' : '';
      return '<div class="rec"><div class="avatar">' + initials(e.fio) + '</div>' +
        '<div class="info"><div class="n">' + esc(e.fio) + ' ' + badge + '</div><div class="d">' + comp + e.iin + '</div><div class="d2">' + dev + login + '</div></div>' +
        '<div class="acts">' + reset + '<button class="iconbtn" data-edit="' + e.iin + '" title="Изменить">✎</button>' +
        '<button class="iconbtn danger" data-del="' + e.iin + '" title="Удалить">✕</button></div></div>';
    }).join('');
    list.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { startEdit(b.dataset.edit, emps); }); });
    list.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { delEmployee(b.dataset.del); }); });
    list.querySelectorAll('[data-resetdev]').forEach(function (b) { b.addEventListener('click', function () { resetDevice(b.dataset.resetdev); }); });
  }
  function startEdit(iin, emps) {
    var e = emps.find(function (x) { return x.iin === iin; }); if (!e) return;
    $('empCompany').value = e.company || ''; $('empIin').value = e.iin; $('empFio').value = e.fio; $('empPass').value = ''; $('empRole').value = e.role;
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

  var video = null, stream = null, rafId = null;
  var canvas = document.createElement('canvas');
  var cctx = canvas.getContext('2d', { willReadFrequently: true });

  function camError(e) {
    var n = (e && e.name) || '';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Доступ к камере запрещён. Разрешите камеру для этого сайта в настройках браузера и попробуйте снова.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return 'Камера на устройстве не найдена.';
    if (n === 'NotReadableError' || n === 'TrackStartError') return 'Камера занята другим приложением. Закройте программы, использующие камеру, и попробуйте снова.';
    return 'Не удалось открыть камеру: ' + (n || e);
  }
  async function openCamera() {
    try { return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
    catch (e1) { return await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
  }
  function scanLoop() {
    if (!scanning) return;
    if (video && video.readyState >= 2 && video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      cctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        var img = cctx.getImageData(0, 0, canvas.width, canvas.height);
        var res = (typeof jsQR !== 'undefined') ? jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }) : null;
        if (res && res.data) { onDecoded(res.data); return; }
      } catch (e) {}
    }
    rafId = requestAnimationFrame(scanLoop);
  }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('fail')); }; document.head.appendChild(s); }); }
  async function ensureJsQR() {
    if (typeof jsQR !== 'undefined') return true;
    var urls = ['https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js', 'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js', 'https://cdn.jsdelivr.net/npm/jsqr@1.3.1/dist/jsQR.min.js'];
    for (var i = 0; i < urls.length; i++) { try { await loadScript(urls[i]); if (typeof jsQR !== 'undefined') return true; } catch (e) {} }
    return typeof jsQR !== 'undefined';
  }

  async function startScanner() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus('Браузер не поддерживает камеру, либо сайт открыт не по https.'); return; }
    setStatus('Загрузка сканера…');
    var ready = await ensureJsQR();
    if (!ready) { setStatus('Сканер не загрузился. Проверьте интернет и обновите страницу.'); return; }
    hideResult();
    var reader = $('reader');
    if (!video) { video = document.createElement('video'); video.setAttribute('playsinline', ''); video.setAttribute('autoplay', ''); video.muted = true; }
    reader.innerHTML = ''; reader.appendChild(video);
    $('scanBtn').style.display = 'none'; $('stopBtn').style.display = 'block';
    setStatus('Запрашиваем камеру…');
    try { stream = await openCamera(); }
    catch (e) {
      reader.innerHTML = ''; $('scanBtn').style.display = 'block'; $('stopBtn').style.display = 'none';
      setStatus(camError(e)); return;
    }
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}
    scanning = true;
    setStatus('Наведите камеру на QR-код со «Станции».');
    rafId = requestAnimationFrame(scanLoop);
  }
  async function stopScanner() {
    scanning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); stream = null; }
    if (video) { try { video.srcObject = null; } catch (e) {} }
    $('reader').innerHTML = '';
    $('scanBtn').style.display = 'block'; $('stopBtn').style.display = 'none';
    if (!$('result').classList.contains('show')) setStatus('');
  }

  async function onDecoded(text) {
    if (busy) return; busy = true;
    await stopScanner();
    setStatus('Фиксируем отметку…');
    var dev = await gatherDevice();
    var geo = await getGeo();
    var r = await api('checkin', { method: 'POST', body: JSON.stringify({ code: text, deviceId: deviceUID(), deviceLabel: dev.label, geo: geo }) });
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
  function geoStr(g) { return g && g.lat != null ? (g.lat + ', ' + g.lng) : ''; }
  function mapsUrl(g) { return g && g.lat != null ? ('https://maps.google.com/?q=' + g.lat + ',' + g.lng) : ''; }
  function haversine(aLat, aLng, bLat, bLng) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
    var x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function fmtDist(m) { return m < 1000 ? (Math.round(m) + ' м') : ((m / 1000).toFixed(1) + ' км'); }
  var office = { lat: null, lng: null, radius: 200 };
  // Возвращает { text, inZone(bool|null), url }
  function geoInfo(g) {
    if (!g || g.lat == null) return { text: '', inZone: null, url: '' };
    var url = mapsUrl(g);
    if (office.lat == null) return { text: g.lat.toFixed(4) + ',' + g.lng.toFixed(4), inZone: null, url: url };
    var d = haversine(office.lat, office.lng, g.lat, g.lng);
    if (d <= (office.radius || 200)) return { text: 'в офисе', inZone: true, url: url };
    return { text: 'вне зоны · ' + fmtDist(d), inZone: false, url: url };
  }
  function geoLink(g) {
    var gi = geoInfo(g);
    if (!gi.text) return '';
    var color = gi.inZone === true ? 'var(--green)' : (gi.inZone === false ? 'var(--red)' : 'var(--blue)');
    return '<a href="' + gi.url + '" target="_blank" style="color:' + color + ';text-decoration:none">📍 ' + esc(gi.text) + '</a>';
  }
  function shortId(id) { return id ? ('#' + String(id).replace(/-/g, '').slice(0, 6)) : ''; }
  var lastRows = [], lastFails = [], lastEvents = [];
  async function renderJournal() {
    var qs = 'from=' + encodeURIComponent($('fromDate').value) + '&to=' + encodeURIComponent($('toDate').value) + '&q=' + encodeURIComponent($('search').value.trim());
    var r = await api('journal?' + qs);
    if (r.status === 401) { showLogin(); return; }
    if (!r.ok) return;
    var rows = r.data.records || []; lastRows = rows;
    var fails = r.data.fails || []; lastFails = fails;
    lastEvents = r.data.events || [];
    if (r.data.office) office = r.data.office;
    $('journalCount').textContent = r.data.total ? (r.data.count + ' / ' + r.data.total) : '';
    var list = $('journalList');
    if (!rows.length) { list.innerHTML = '<div class="empty"><div class="big">🗂️</div>' + (r.data.total ? 'За выбранный период отметок нет.' : 'Отметок пока нет.') + '</div>'; }
    else list.innerHTML = rows.map(function (rr) {
      var late = rr.late ? '<span class="badge late">+' + rr.lateMin + 'м</span>' : '';
      var comp = rr.company ? (esc(rr.company) + ' · ') : '';
      var inLine = '<div class="d2">↓ приход · 📱 ' + esc(rr.device || '—') + ' ' + shortId(rr.deviceId) + ' · IP ' + esc(rr.ip || '—') + (geoLink(rr.geo) ? (' · ' + geoLink(rr.geo)) : '') + '</div>';
      var outLine = rr.out ? ('<div class="d2">↑ уход · 📱 ' + esc(rr.outDevice || rr.device || '—') + ' ' + shortId(rr.outDeviceId || rr.deviceId) + ' · IP ' + esc(rr.outIp || '—') + (geoLink(rr.outGeo) ? (' · ' + geoLink(rr.outGeo)) : '') + '</div>') : '';
      return '<div class="rec"><div class="avatar">' + initials(rr.fio) + '</div>' +
        '<div class="info"><div class="n">' + esc(rr.fio) + ' ' + late + '</div><div class="d">' + comp + rr.iin + ' · ' + rr.date + '</div>' + inLine + outLine + '</div>' +
        '<div class="jtimes"><div><span>приход</span>' + rr.in + '</div><div><span>уход</span>' + (rr.out||'—') + '</div><div class="jw">' + fmtDur(workedMin(rr)) + '</div></div></div>';
    }).join('');
    // все события: входы и отметки (успешные и нет), с гео и устройством
    var fl = $('failList');
    if (fl) {
      var evs = r.data.events || [];
      $('failHead').style.display = evs.length ? 'flex' : 'none';
      fl.innerHTML = evs.map(function (e) {
        var who = (e.fio ? esc(e.fio) + ' · ' : '') + (e.iin || '—');
        var geo = geoLink(e.geo);
        var typ = e.type === 'login' ? 'вход' : 'отметка';
        var okColor = e.ok === false ? 'var(--red)' : 'var(--green)';
        var border = e.ok === false ? 'var(--red)' : 'var(--line)';
        return '<div class="rec" style="border-left:3px solid ' + border + '"><div class="info">' +
          '<div class="n" style="color:' + okColor + '">' + esc(e.reason || (e.ok === false ? 'отказ' : 'успех')) + ' <span class="count">(' + typ + ')</span></div>' +
          '<div class="d">' + who + ' · ' + e.date + ' ' + e.time + '</div>' +
          '<div class="d2">📱 ' + esc(e.device || '—') + ' ' + shortId(e.uid) + ' · IP ' + esc(e.ip || '—') + (geo ? (' · ' + geo) : '') + '</div></div></div>';
      }).join('');
    }
  }
  function periodLabel() { return 'Период: ' + ($('fromDate').value || '…') + ' — ' + ($('toDate').value || '…'); }
  function downloadBlob(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  $('failCsvBtn') && $('failCsvBtn').addEventListener('click', function () {
    var rows = lastEvents.slice();
    var data = [['Тип','Результат','Действие','ИИН','ФИО','Дата','Время','Устройство','ID устройства','IP','Зона','Координаты','Карта']]
      .concat(rows.map(function (e) { var gi = geoInfo(e.geo); return [e.type === 'login' ? 'вход' : 'отметка', e.ok === false ? 'отказ' : 'успех', e.reason || '', e.iin || '', e.fio || '', e.date || '', e.time || '', e.device || '', e.uid || '', e.ip || '', gi.text || '', geoStr(e.geo), gi.url || '']; }));
    var csv = data.map(function (row) { return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), 'sobytiya-' + fileTag() + '.csv');
  });
  $('csvBtn').addEventListener('click', function () {
    var rows = lastRows.slice().sort(function (a, b) { return a.ts - b.ts; });
    var data = [['№','Компания','ФИО','ИИН','Дата','Приход','Уход','Часы','Опоздание, мин','Устройство','ID устройства','IP','Зона','Координаты','Карта']]
      .concat(rows.map(function (r, i) { var gi = geoInfo(r.geo); return [i+1, r.company||'', r.fio, r.iin, r.date, r.in, r.out||'', fmtDur(workedMin(r)), r.lateMin||0, r.device||'', r.deviceId||'', r.ip||'', gi.text || '', geoStr(r.geo), gi.url || '']; }));
    var csv = data.map(function (row) { return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), 'prihod-' + fileTag() + '.csv');
  });
  function geoShort(g) { return g && g.lat != null ? (g.lat.toFixed(4) + ',' + g.lng.toFixed(4)) : '—'; }
  function fileTag() {
    var q = $('search').value.trim();
    var who = q ? ('-' + q.replace(/[^\wа-яёА-ЯЁ0-9]+/gi, '_').slice(0, 30)) : '';
    return $('fromDate').value + '_' + $('toDate').value + who;
  }
  $('pdfBtn').addEventListener('click', function () {
    var rows = lastRows.slice().sort(function (a, b) { return a.ts - b.ts; });
    if (!rows.length) { alert('За выбранный период нет отметок.'); return; }
    if (typeof pdfMake === 'undefined') { alert('Модуль PDF не загрузился.'); return; }
    var now = new Date(), lateCount = rows.filter(function (r) { return r.late; }).length;
    var who = $('search').value.trim();
    var body = [['№','Компания','ФИО','ИИН','Дата','Приход','Уход','Часы','Опозд.','Устройство','IP','Где'].map(function (h) { return { text: h, style: 'th' }; })];
    rows.forEach(function (r, i) {
      var gi = geoInfo(r.geo);
      var geoCell = gi.text ? { text: gi.text, link: gi.url, fontSize: 6, color: gi.inZone === false ? '#c0392b' : (gi.inZone === true ? '#2e7d32' : '#1565c0') } : { text: '—', fontSize: 6 };
      body.push([
        { text: String(i+1) }, { text: r.company||'—' }, { text: r.fio }, { text: r.iin }, { text: r.date },
        { text: r.in||'—' }, { text: r.out||'—' }, { text: fmtDur(workedMin(r)) },
        { text: r.lateMin ? (r.lateMin + 'м') : '—', color: r.late ? '#c0392b' : '#000' },
        { text: (r.device || '—') + (r.deviceId ? (' ' + shortId(r.deviceId)) : ''), fontSize: 6 }, { text: r.ip||'—', fontSize: 6 }, geoCell,
      ]);
    });
    var dd = {
      pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [16, 50, 16, 40],
      content: [
        { text: 'Отчёт по приходу сотрудников', fontSize: 15, bold: true, margin: [0,0,0,3] },
        { text: periodLabel() + (who ? ('   ·   Сотрудник: ' + who) : ''), fontSize: 10, color: '#666' },
        { text: 'Всего отметок: ' + rows.length + '   ·   Опозданий: ' + lateCount + '   ·   Сформировано: ' + todayStr(now) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()), fontSize: 9, color: '#888', margin: [0,1,0,12] },
        { table: { headerRows: 1, widths: [12,72,'*',60,42,28,28,32,24,72,52,64], body: body }, layout: 'lightHorizontalLines' },
      ],
      styles: { th: { bold: true, fillColor: '#f0f0f0', fontSize: 7 } },
      defaultStyle: { fontSize: 7 },
      footer: function (cur, total) { return { text: cur + ' / ' + total, alignment: 'center', fontSize: 8, color: '#999', margin: [0,6,0,0] }; },
    };
    pdfMake.createPdf(dd).download('prihod-' + fileTag() + '.pdf');
  });

  boot();
})();
