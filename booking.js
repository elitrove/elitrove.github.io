/* Call request calendar for the Elitrove website.
   A visitor picks a day and time, and the page writes a request that the
   visitor sends by email or Instagram. Nothing is stored or sent by the site.
   To change the hours offered, edit CONFIG below. CONFIG hours are Central Time.
   Visitors see each time in their own time zone. The request also states Central
   Time so Elitrove reads every request the same way. */
(function () {
  'use strict';

  var CONFIG = Object.freeze({
    timeZone: 'America/Chicago',
    zoneLabel: 'Central Time',
    startHour: 7,        // first call starts 7:00 AM Central
    endHour: 15,         // last call starts 2:30 PM Central
    slotMinutes: 30,
    daysAhead: 10,       // weekdays shown
    minLeadHours: 18,    // notice needed before a call
    instagramUrl: 'https://ig.me/m/elitrove'
  });
  var MS_PER_MINUTE = 60000;
  var MS_PER_HOUR = 3600000;
  var MS_PER_DAY = 86400000;
  var FIELD_LIMIT = 80;
  var WEEKEND = ['Sat', 'Sun'];

  /* ---------- time helpers (no page access) ---------- */

  function zonedParts(date, timeZone) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
    }).formatToParts(date);
    var found = {};
    parts.forEach(function (part) { found[part.type] = part.value; });
    return {
      year: Number(found.year), month: Number(found.month), day: Number(found.day),
      hour: Number(found.hour), minute: Number(found.minute), weekday: found.weekday
    };
  }

  function zonedToUtc(year, month, day, hour, minute, timeZone) {
    var wanted = Date.UTC(year, month - 1, day, hour, minute);
    var seen = zonedParts(new Date(wanted), timeZone);
    var shown = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    return new Date(wanted - (shown - wanted));
  }

  function nextBusinessDays(now, count, timeZone) {
    var days = [];
    var cursor = new Date(now.getTime());
    while (days.length < count) {
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
      var parts = zonedParts(cursor, timeZone);
      if (WEEKEND.indexOf(parts.weekday) === -1) {
        days.push({ year: parts.year, month: parts.month, day: parts.day });
      }
    }
    return days;
  }

  function slotsForDay(day, config, now) {
    var earliest = now.getTime() + config.minLeadHours * MS_PER_HOUR;
    var slots = [];
    for (var minutes = config.startHour * 60; minutes < config.endHour * 60; minutes += config.slotMinutes) {
      var utc = zonedToUtc(day.year, day.month, day.day, Math.floor(minutes / 60), minutes % 60, config.timeZone);
      if (utc.getTime() >= earliest) { slots.push({ utc: utc }); }
    }
    return slots;
  }

  function format(date, timeZone, options) {
    var settings = Object.assign({ timeZone: timeZone }, options);
    return new Intl.DateTimeFormat('en-US', settings).format(date);
  }

  function timeOnly(date, timeZone) {
    return format(date, timeZone, { hour: 'numeric', minute: '2-digit' });
  }

  function describeSlot(date, timeZone) {
    return format(date, timeZone, { weekday: 'long', month: 'long', day: 'numeric' }) + ' at ' + timeOnly(date, timeZone);
  }

  function shortSlot(date, timeZone) {
    return format(date, timeZone, { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + timeOnly(date, timeZone);
  }

  /* ---------- request helpers (no page access) ---------- */

  function cleanField(value, limit) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function missingFields(entry) {
    var missing = [];
    if (!entry.slotUtc) { missing.push('a day and time'); }
    if (!entry.name) { missing.push('your name'); }
    if (!entry.contact) { missing.push('how to reach you'); }
    return missing;
  }

  function buildRequest(entry, config, email) {
    var subject = 'Call request: ' + shortSlot(entry.slotUtc, config.timeZone) + ' ' + config.zoneLabel;
    var lines = [
      "Hi Elitrove, I'd like to book a call.",
      '',
      'Time: ' + describeSlot(entry.slotUtc, config.timeZone) + ' ' + config.zoneLabel,
      'My time: ' + describeSlot(entry.slotUtc, entry.visitorZone) + ' (' + entry.visitorZone + ')',
      'Name: ' + entry.name,
      'Business: ' + (entry.business || 'not given'),
      'Reach me at: ' + entry.contact,
      '',
      'Sent from elitrove.github.io'
    ];
    var body = lines.join('\n');
    var mailto = 'mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    return { subject: subject, body: body, mailto: mailto };
  }

  /* ---------- page ---------- */

  function makePick(label, detail, onPick) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'pick';
    button.setAttribute('aria-pressed', 'false');
    var top = document.createElement('b');
    top.textContent = label;
    button.appendChild(top);
    if (detail) {
      var bottom = document.createElement('span');
      bottom.textContent = detail;
      button.appendChild(bottom);
    }
    button.addEventListener('click', function () { onPick(button); });
    return button;
  }

  function press(group, chosen) {
    Array.prototype.forEach.call(group.querySelectorAll('.pick'), function (button) {
      button.setAttribute('aria-pressed', String(button === chosen));
    });
  }

  function copyText(text, fallbackBox) {
    function selectForManualCopy() {
      fallbackBox.hidden = false;
      fallbackBox.focus();
      fallbackBox.select();
      return false;
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return Promise.resolve(selectForManualCopy());
    }
    return navigator.clipboard.writeText(text).then(function () { return true; }, selectForManualCopy);
  }

  function startBooking(root) {
    var email = root.getAttribute('data-email');
    var dayGroup = root.querySelector('.days');
    var timeGroup = root.querySelector('.times');
    var summary = root.querySelector('.book-summary');
    var status = root.querySelector('.book-status');
    var textBox = root.querySelector('.book-text');
    var visitorZone = Intl.DateTimeFormat().resolvedOptions().timeZone || CONFIG.timeZone;
    var chosenSlot = null;

    function field(name) {
      return cleanField(root.querySelector('[name="' + name + '"]').value, FIELD_LIMIT);
    }

    function entry() {
      return { slotUtc: chosenSlot, visitorZone: visitorZone, name: field('name'), business: field('business'), contact: field('contact') };
    }

    function showSummary() {
      if (!chosenSlot) { summary.textContent = 'Pick a day, then a time.'; return; }
      summary.textContent = describeSlot(chosenSlot, visitorZone) + ' your time';
    }

    function showTimes(day) {
      chosenSlot = null;
      timeGroup.textContent = '';
      var slots = slotsForDay(day, CONFIG, new Date());
      if (!slots.length) {
        var none = document.createElement('p');
        none.className = 'book-empty';
        none.textContent = 'No times left on this day. Pick another day.';
        timeGroup.appendChild(none);
      }
      slots.forEach(function (slot) {
        timeGroup.appendChild(makePick(timeOnly(slot.utc, visitorZone), '', function (button) {
          chosenSlot = slot.utc;
          press(timeGroup, button);
          showSummary();
        }));
      });
      showSummary();
    }

    function readyRequest() {
      var current = entry();
      var missing = missingFields(current);
      if (missing.length) {
        status.textContent = 'Still needed: ' + missing.join(', ') + '.';
        return null;
      }
      var request = buildRequest(current, CONFIG, email);
      textBox.value = request.subject + '\n\n' + request.body;
      return request;
    }

    var EXTRA_DAYS = 2; // spare days, so days without free times can be left out
    var openDays = nextBusinessDays(new Date(), CONFIG.daysAhead + EXTRA_DAYS, CONFIG.timeZone).filter(function (day) {
      return slotsForDay(day, CONFIG, new Date()).length > 0;
    }).slice(0, CONFIG.daysAhead);
    openDays.forEach(function (day) {
      var noon = zonedToUtc(day.year, day.month, day.day, 12, 0, CONFIG.timeZone);
      var label = format(noon, CONFIG.timeZone, { weekday: 'short' });
      var detail = format(noon, CONFIG.timeZone, { month: 'short', day: 'numeric' });
      dayGroup.appendChild(makePick(label, detail, function (button) {
        press(dayGroup, button);
        showTimes(day);
      }));
    });

    root.querySelector('.book-email').addEventListener('click', function () {
      var request = readyRequest();
      if (!request) { return; }
      textBox.hidden = false;
      status.textContent = 'Your mail app should open with the request ready to send. If it does not, copy the text below and send it to ' + email + ' or to @elitrove on Instagram.';
      window.location.href = request.mailto;
    });

    root.querySelector('.book-instagram').addEventListener('click', function () {
      var request = readyRequest();
      if (!request) { return; }
      copyText(textBox.value, textBox).then(function (copied) {
        status.textContent = copied
          ? 'Copied. Paste it in the chat with @elitrove and send.'
          : 'Copy the text below, then paste it in the chat with @elitrove.';
        window.open(CONFIG.instagramUrl, '_blank', 'noopener');
      });
    });

    showSummary();
    root.hidden = false;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      zonedParts: zonedParts, zonedToUtc: zonedToUtc, nextBusinessDays: nextBusinessDays,
      slotsForDay: slotsForDay, describeSlot: describeSlot, cleanField: cleanField,
      missingFields: missingFields, buildRequest: buildRequest, config: CONFIG
    };
    return;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('booking');
    if (!root) { return; }
    try {
      startBooking(root);
    } catch (problem) {
      root.hidden = true; // the Instagram button next to it still works
      console.error('The call request calendar could not start.', problem);
    }
  });
})();
