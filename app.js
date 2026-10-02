/* =============================================================
   StormMC — site behaviour
   Edit CONFIG only: the IP/status/discord values below are the
   single source of truth and are injected into the page on load.
   ============================================================= */
(function () {
  'use strict';

  var CONFIG = {
    name: 'StormMC',
    ip: 'play.stormmc.top',
    version: '26.2',
    discord: 'https://discord.gg/ET9gd94Sx',
    statusApi: 'https://api.mcsrvstat.us/3/',
    refreshMs: 60000
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------ config injection ------------------------------ */
  $$('[data-ip]').forEach(function (el) { el.textContent = CONFIG.ip; });
  $$('[data-discord]').forEach(function (el) { el.href = CONFIG.discord; });
  $$('[data-version]').forEach(function (el) { el.textContent = CONFIG.version; });
  $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ------------------------------ toast ------------------------------ */
  var toast = $('#toast');
  var toastTimer = null;
  var CHECK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 7 9 19l-5.5-5.5L4.6 11 9 15.4 19.4 5Z"/></svg>';

  function showToast(msg) {
    if (!toast) return;
    toast.innerHTML = CHECK_SVG + '<span></span>';
    toast.querySelector('span').textContent = msg;
    toast.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('is-open'); }, 2600);
  }

  /* ------------------------------ clipboard ------------------------------ */
  function copyViaTextarea(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy-failed'));
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      /* some browsers stall without a user gesture — race it, then fall back */
      var stall = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('clipboard-timeout')); }, 1200);
      });
      return Promise.race([navigator.clipboard.writeText(text), stall])
        .catch(function () { return copyViaTextarea(text); });
    }
    return copyViaTextarea(text);
  }

  $$('[data-copy-ip]').forEach(function (el) {
    el.addEventListener('click', function () {
      copyText(CONFIG.ip).then(function () {
        showToast(CONFIG.ip + ' copied');
        flashCopied(el);
      }).catch(function () {
        showToast('Copy failed — select the IP manually');
      });
    });
  });

  function flashCopied(el) {
    var pill = el.classList.contains('ip-pill') ? el : el.closest('.ip-pill');
    if (pill) {
      pill.classList.add('is-copied');
      var copyIco = $('.ico-copy', pill), checkIco = $('.ico-check', pill);
      if (copyIco) copyIco.hidden = true;
      if (checkIco) checkIco.hidden = false;
      setTimeout(function () {
        pill.classList.remove('is-copied');
        if (copyIco) copyIco.hidden = false;
        if (checkIco) checkIco.hidden = true;
      }, 1800);
    }
    var icon = el.querySelector('[data-copy-icon]');
    if (icon && icon.textContent !== 'check') {
      icon.textContent = 'check';
      setTimeout(function () { icon.textContent = 'content_copy'; }, 1800);
    }
  }

  /* ------------------------------ live server status ------------------------------ */
  var statusEls = {
    dots: $$('[data-status-dot]'),
    labels: $$('[data-status-label]'),
    online: $('[data-players-online]'),
    max: $('[data-players-max]'),
    version: $('[data-version]'),
    checked: $('[data-last-checked]'),
    refresh: $('[data-refresh]')
  };
  var lastCheckedAt = 0;
  var refreshBusy = false;

  function setStatus(state, label) {
    statusEls.dots.forEach(function (d) {
      d.classList.remove('is-online', 'is-offline', 'is-checking');
      d.classList.add('is-' + state);
    });
    statusEls.labels.forEach(function (l) { l.textContent = label; });
  }

  function animateNumber(el, target, decimals) {
    if (!el) return;
    if (reducedMotion) { el.textContent = String(target); return; }
    var from = parseInt(String(el.textContent).replace(/\D/g, ''), 10);
    if (isNaN(from)) from = 0;
    var start = performance.now();
    var dur = 650;
    (function step(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      var val = from + (target - from) * eased;
      el.textContent = decimals ? val.toFixed(1) : String(Math.round(val));
      if (t < 1) requestAnimationFrame(step);
    })(start);
  }

  function announceStatus(state, online, max) {
    try {
      window.dispatchEvent(new CustomEvent('storm:status', {
        detail: { state: state, online: online, max: max }
      }));
    } catch (e) { /* CustomEvent unsupported — ignore */ }
  }

  function renderStatus(data, failed) {
    if (failed) {
      setStatus('offline', 'Status unavailable');
      if (statusEls.online) statusEls.online.textContent = '—';
      if (statusEls.max) statusEls.max.textContent = '—';
      announceStatus('unavailable', null, null);
      return;
    }
    if (data && data.online) {
      setStatus('online', 'Server online');
      var p = data.players || {};
      var online = typeof p.online === 'number' ? p.online : 0;
      var max = typeof p.max === 'number' ? p.max : null;
      animateNumber(statusEls.online, online, false);
      if (statusEls.max) statusEls.max.textContent = max == null ? '?' : String(max);
      if (statusEls.version && data.version) statusEls.version.textContent = data.version;
      announceStatus('online', online, max);
    } else {
      setStatus('offline', 'Offline · pre-launch');
      if (statusEls.online) statusEls.online.textContent = '0';
      if (statusEls.max) statusEls.max.textContent = '—';
      if (statusEls.online) statusEls.online.classList.add('is-off');
      announceStatus('offline', 0, null);
    }
  }

  function fetchStatus(manual) {
    if (refreshBusy) return;
    refreshBusy = true;
    if (manual && statusEls.refresh) statusEls.refresh.classList.add('is-spinning');
    setStatus('checking', 'Checking server…');

    fetch(CONFIG.statusApi + encodeURIComponent(CONFIG.ip), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        renderStatus(data, false);
        lastCheckedAt = Date.now();
      })
      .catch(function () {
        renderStatus(null, true);
        lastCheckedAt = Date.now();
      })
      .then(function () {
        refreshBusy = false;
        if (statusEls.refresh) statusEls.refresh.classList.remove('is-spinning');
        tick();
      });
  }

  if (statusEls.refresh) {
    statusEls.refresh.addEventListener('click', function () { fetchStatus(true); });
  }

  /* ------------------------------ countdowns ------------------------------ */
  var voteTimers = [];
  $$('.vote-card').forEach(function (card) {
    var url = (card.getAttribute('data-url') || '').trim();
    var badge = card.querySelector('[data-badge]');
    var box = card.querySelector('[data-vote-actions]');
    var hours = parseInt(card.getAttribute('data-reset'), 10) || 12;
    var seed = card.getAttribute('data-name').length;

    if (url && badge && box) {
      badge.textContent = 'Live';
      badge.classList.remove('badge-soon');
      badge.classList.add('badge-live');
      var a = document.createElement('a');
      a.className = 'btn btn-filled';
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Vote now';
      box.appendChild(a);
    }

    var cd = card.querySelector('[data-countdown]');
    if (cd) voteTimers.push({ el: cd, hours: hours, offset: seed * 7 * 60000 });
  });

  function nextReset(hours, offsetMs) {
    var period = hours * 3600000;
    var now = Date.now();
    return Math.ceil((now - offsetMs) / period) * period + offsetMs;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function updateCountdowns() {
    var now = Date.now();
    voteTimers.forEach(function (t) {
      var left = Math.max(0, nextReset(t.hours, t.offset) - now);
      var h = Math.floor(left / 3600000);
      var m = Math.floor((left % 3600000) / 60000);
      var s = Math.floor((left % 60000) / 1000);
      t.el.textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
    });
  }

  /* one heartbeat drives countdowns + "last checked" copy */
  function tick() {
    updateCountdowns();
    if (!statusEls.checked) return;
    if (!lastCheckedAt) { statusEls.checked.textContent = 'not checked yet'; return; }
    var secs = Math.round((Date.now() - lastCheckedAt) / 1000);
    statusEls.checked.textContent =
      secs < 5 ? 'checked just now' :
      secs < 60 ? 'checked ' + secs + 's ago' :
      'checked ' + Math.floor(secs / 60) + 'm ago';
  }

  /* ------------------------------ topbar + drawer ------------------------------ */
  var topbar = $('#topbar');
  var onScroll = function () {
    if (topbar) topbar.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var menuBtn = $('#menu-btn');
  var drawer = $('#drawer');
  var scrim = $('#scrim');
  var drawerClose = $('#drawer-close');

  function openDrawer() {
    if (!drawer || !scrim) return;
    drawer.hidden = false;
    scrim.hidden = false;
    setTimeout(function () {
      drawer.classList.add('is-open');
      scrim.classList.add('is-open');
    }, 16);
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    if (drawerClose) drawerClose.focus();
  }

  function closeDrawer(refocus) {
    if (!drawer || !scrim || drawer.hidden) return;
    drawer.classList.remove('is-open');
    scrim.classList.remove('is-open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    setTimeout(function () {
      drawer.hidden = true;
      scrim.hidden = true;
    }, 450);
    if (refocus && menuBtn) menuBtn.focus();
  }

  if (menuBtn) menuBtn.addEventListener('click', openDrawer);
  if (drawerClose) drawerClose.addEventListener('click', function () { closeDrawer(true); });
  if (scrim) scrim.addEventListener('click', function () { closeDrawer(true); });
  $$('.drawer-list a').forEach(function (a) {
    a.addEventListener('click', function () { closeDrawer(false); });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer(true);
    /* simple focus trap while the drawer is open */
    if (e.key === 'Tab' && drawer && !drawer.hidden && drawer.classList.contains('is-open')) {
      var focusables = $$('a[href], button:not([disabled])', drawer);
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ------------------------------ reveal on scroll ------------------------------ */
  var revealEls = $$('.reveal');
  function sweepReveals() {
    revealEls.forEach(function (el) {
      if (el.classList.contains('in')) return;
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('in');
    });
  }
  if ('IntersectionObserver' in window && !reducedMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
    /* webfont swap can shift layout after the first IO pass — sweep again */
    window.addEventListener('load', function () { setTimeout(sweepReveals, 400); });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { setTimeout(sweepReveals, 300); });
    }
    setTimeout(sweepReveals, 1600);
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  /* ------------------------------ scroll-spy nav ------------------------------ */
  var navLinks = $$('.nav-link');
  var spied = navLinks
    .map(function (link) { return { link: link, section: $(link.getAttribute('href')) }; })
    .filter(function (x) { return x.section; });

  function updateSpy() {
    if (!spied.length) return;
    var line = window.scrollY + window.innerHeight * 0.35;
    var current = null;
    spied.forEach(function (x) {
      var top = x.section.getBoundingClientRect().top + window.scrollY;
      if (top <= line) current = x;
    });
    spied.forEach(function (x) {
      var active = x === current;
      x.link.classList.toggle('is-active', active);
      if (active) x.link.setAttribute('aria-current', 'true');
      else x.link.removeAttribute('aria-current');
    });
  }
  window.addEventListener('scroll', updateSpy, { passive: true });
  window.addEventListener('resize', updateSpy);
  updateSpy();

  /* ------------------------------ accordion ------------------------------ */
  $$('.acc-trigger').forEach(function (btn) {
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (!panel) return;
    if (!btn.id) btn.id = 'acc-btn-' + panel.id;
    panel.setAttribute('aria-labelledby', btn.id);

    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      var item = btn.closest('.acc-item');
      if (item) item.classList.toggle('is-open', !open);
    });
  });

  /* ------------------------------ rules / FAQ switch ------------------------------ */
  var chipRules = $('#chip-rules');
  var chipFaq = $('#chip-faq');
  var panelRules = $('#panel-rules');
  var panelFaq = $('#panel-faq');

  function showPanel(which) {
    if (panelRules) panelRules.hidden = which !== 'rules';
    if (panelFaq) panelFaq.hidden = which !== 'faq';
    if (chipRules) chipRules.selected = which === 'rules';
    if (chipFaq) chipFaq.selected = which === 'faq';
    $$('.reveal', which === 'rules' ? panelRules : panelFaq).forEach(function (el) {
      el.classList.add('in');
    });
  }

  if (chipRules) chipRules.addEventListener('click', function () { showPanel('rules'); });
  if (chipFaq) chipFaq.addEventListener('click', function () { showPanel('faq'); });

  /* ------------------------------ gallery filters ------------------------------ */
  var filterChips = $$('.filter-chip');
  var galleryItems = $$('.gallery-item');
  var galleryEmpty = $('#gallery-empty');

  function applyFilter(filter) {
    var visible = 0;
    galleryItems.forEach(function (item) {
      var match = filter === 'all' || item.getAttribute('data-cat') === filter;
      item.hidden = !match;
      if (match) { visible++; item.classList.add('in'); }
    });
    if (galleryEmpty) galleryEmpty.hidden = visible > 0;
    if (lightboxIndex > -1) syncLightbox();
  }

  filterChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      filterChips.forEach(function (c) { c.selected = c === chip; });
      applyFilter(chip.getAttribute('data-filter') || 'all');
    });
  });

  /* ------------------------------ lightbox ------------------------------ */
  var lightbox = $('#lightbox');
  var lbImg = $('#lb-img');
  var lbCaption = $('#lb-caption');
  var lbCounter = $('#lb-counter');
  var lightboxIndex = -1;

  function visibleItems() {
    return galleryItems.filter(function (item) { return !item.hidden; });
  }

  function syncLightbox() {
    var items = visibleItems();
    if (lightboxIndex < 0 || !items.length) return;
    if (lightboxIndex >= items.length) lightboxIndex = 0;
    var item = items[lightboxIndex];
    var img = $('img', item);
    var caption = $('.gallery-caption', item);
    if (lbImg && img) { lbImg.src = img.getAttribute('src'); lbImg.alt = img.alt; }
    if (lbCaption && caption) lbCaption.textContent = caption.textContent;
    if (lbCounter) lbCounter.textContent = (lightboxIndex + 1) + ' / ' + items.length;
  }

  function openDialog() {
    if (!lightbox) return;
    var run = function () {
      if (typeof lightbox.show === 'function') {
        var p = lightbox.show();
        if (p && p.catch) p.catch(function () {});
      } else {
        lightbox.setAttribute('open', '');
      }
    };
    if (customElements.get('md-dialog')) run();
    else customElements.whenDefined('md-dialog').then(run).catch(function () {});
  }

  function closeDialog() {
    if (!lightbox) return;
    if (typeof lightbox.close === 'function') lightbox.close();
    else lightbox.removeAttribute('open');
    /* safety: if the exit transition never resolves, force the final state */
    setTimeout(function () {
      if (lightbox && lightbox.hasAttribute('open')) lightbox.removeAttribute('open');
    }, 1200);
    lightboxIndex = -1;
  }

  function stepLightbox(delta) {
    var items = visibleItems();
    if (!items.length) return;
    lightboxIndex = (lightboxIndex + delta + items.length) % items.length;
    syncLightbox();
  }

  galleryItems.forEach(function (item) {
    var btn = $('.gallery-open', item);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var items = visibleItems();
      lightboxIndex = items.indexOf(item);
      if (lightboxIndex < 0) lightboxIndex = 0;
      syncLightbox();
      openDialog();
    });
  });

  var lbPrev = $('#lb-prev'), lbNext = $('#lb-next'), lbClose = $('#lb-close');
  if (lbPrev) lbPrev.addEventListener('click', function () { stepLightbox(-1); });
  if (lbNext) lbNext.addEventListener('click', function () { stepLightbox(1); });
  if (lbClose) lbClose.addEventListener('click', closeDialog);
  if (lightbox) {
    lightbox.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
    });
  }

  /* ------------------------------ community link cards ------------------------------ */
  $$('.link-card[data-url]').forEach(function (card) {
    var url = (card.getAttribute('data-url') || '').trim();
    var cta = $('[data-cta]', card);
    if (url) {
      card.setAttribute('href', url);
      card.setAttribute('target', '_blank');
      card.setAttribute('rel', 'noopener');
      if (cta) {
        cta.childNodes[0].nodeValue = 'Open';
      }
    } else {
      card.removeAttribute('href');
      card.classList.add('is-soon');
      card.setAttribute('aria-disabled', 'true');
      var arrow = cta ? cta.querySelector('svg') : null;
      if (arrow) arrow.style.display = 'none';
      card.addEventListener('click', function (e) { e.preventDefault(); });
    }
  });

  /* ------------------------------ boot ------------------------------ */
  tick();
  setInterval(tick, 1000);
  fetchStatus(false);
  setInterval(function () {
    if (!document.hidden) fetchStatus(false);
  }, CONFIG.refreshMs);
})();
