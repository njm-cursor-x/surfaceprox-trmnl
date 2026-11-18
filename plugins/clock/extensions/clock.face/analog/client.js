window.slateClock.face("analog", function (el, t) {
  var m = Number(t.minute);
  var s = Number(t.second);
  var set = function (hand, deg) {
    var node = el.querySelector('[data-hand="' + hand + '"]');
    if (node) node.setAttribute("transform", "rotate(" + deg + ")");
  };
  set("hour", (t.h24 % 12) * 30 + m * 0.5);
  set("minute", m * 6);
  var second = el.querySelector('[data-hand="second"]');
  if (second) second.style.display = t.seconds ? "" : "none";
  set("second", s * 6);
});
