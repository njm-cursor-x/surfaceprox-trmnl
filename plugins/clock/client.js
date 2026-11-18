// Shared tick loop for clock faces. Faces register a render(el, parts) callback.
(function () {
  var faces = {};
  window.slateClock = {
    face: function (id, render) {
      faces[id] = render;
    },
  };

  function parts(el, now) {
    var tz = el.dataset.tz || undefined;
    var hour12 = el.dataset.hour12 !== "false";
    var opts = {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: hour12,
    };
    var out = {};
    try {
      new Intl.DateTimeFormat("en-US", opts).formatToParts(now).forEach(function (p) {
        out[p.type] = p.value;
      });
      out.date = new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(now);
    } catch {
      out = {
        hour: String(now.getHours()),
        minute: String(now.getMinutes()).padStart(2, "0"),
        second: "00",
        date: "",
      };
    }
    out.h24 = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(
        now,
      ),
    );
    out.seconds = el.dataset.seconds === "true";
    return out;
  }

  function tick() {
    var now = new Date();
    document.querySelectorAll(".slate-clock").forEach(function (el) {
      var render = faces[el.dataset.face];
      if (render) render(el, parts(el, now), now);
    });
  }

  window.addEventListener("DOMContentLoaded", function () {
    tick();
    setTimeout(
      function () {
        tick();
        setInterval(tick, 1000);
      },
      1000 - (Date.now() % 1000),
    );
  });
})();
