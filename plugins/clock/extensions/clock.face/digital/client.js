window.slateClock.face("digital", function (el, t) {
  var time = t.hour + ":" + t.minute + (t.seconds ? ":" + t.second : "");
  el.querySelector("[data-clock-time]").textContent = time;
  el.querySelector("[data-clock-ampm]").textContent = t.dayPeriod ? " " + t.dayPeriod : "";
  el.querySelector("[data-clock-date]").textContent = t.date;
});
