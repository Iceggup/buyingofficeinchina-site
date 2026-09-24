/* ============================================================
   site.js v2 — no dependencies
   1. contact details from config.js
   2. mobile navigation
   3. image slots: drop a file into /images and it appears
   4. scroll reveal
   5. inquiry form: validation + submit
   ============================================================ */
(function () {
  "use strict";
  var S = window.SITE || {};

  /* ---------- 1. contact details ---------- */
  function wa() {
    var n = String(S.whatsapp || "").replace(/\D/g, "");
    var m = encodeURIComponent(S.whatsappMessage || "");
    return "https://wa.me/" + n + (m ? "?text=" + m : "");
  }
  document.querySelectorAll('a[data-site="whatsapp"]').forEach(function (a) {
    a.href = wa(); a.target = "_blank"; a.rel = "noopener";
  });
  document.querySelectorAll('a[data-site="email"]').forEach(function (a) {
    if (!S.email) return;
    a.href = "mailto:" + S.email;
    if (!a.hasAttribute("data-keep-text")) a.textContent = S.email;
  });
  document.querySelectorAll('[data-site="brand"]').forEach(function (el) {
    if (S.brand) el.textContent = S.brand;
  });
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- 2. mobile navigation ---------- */
  var burger = document.querySelector(".burger");
  var nav = document.querySelector(".nav");
  if (burger && nav) {
    burger.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---------- 3. image slots ----------
     Every <figure class="media" data-img="images/x.jpg"> shows a styled
     placeholder until that file actually exists. Drop the photo in and
     it appears with no code change. */
  document.querySelectorAll(".media[data-img]").forEach(function (fig) {
    var src = fig.getAttribute("data-img");
    if (!src) return;
    var probe = new Image();
    probe.onload = function () {
      var img = document.createElement("img");
      img.src = src;
      img.alt = fig.getAttribute("data-alt") || "";
      img.loading = "lazy";
      fig.insertBefore(img, fig.firstChild);
      fig.classList.add("has-img");
    };
    probe.onerror = function () { /* keep the placeholder */ };
    probe.src = src;
  });

  /* ---------- 4. scroll reveal ---------- */
  var revealables = document.querySelectorAll(".rv");
  if (revealables.length) {
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      revealables.forEach(function (el) { io.observe(el); });
      // safety net: nothing stays invisible, whatever happens
      setTimeout(function () {
        revealables.forEach(function (el) { el.classList.add("in"); });
      }, 1600);
    } else {
      revealables.forEach(function (el) { el.classList.add("in"); });
    }
  }

  /* ---------- 5. inquiry form ---------- */
  var form = document.querySelector("form.inq");
  if (!form) return;

  var msg = form.querySelector(".form-msg");
  var btn = form.querySelector('button[type="submit"]');
  var t0 = Date.now();

  function say(kind, text) {
    if (!msg) return;
    msg.className = "form-msg " + kind;
    msg.textContent = text;
    msg.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var hp = form.querySelector('input[name="company_website"]');
    if (hp && hp.value) return;
    if (Date.now() - t0 < 2500) {
      say("err", "Please take a moment to complete the form, then submit again.");
      t0 = Date.now();
      return;
    }

    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = typeof v === "string" ? v.trim() : v; });

    if (!data.consent) { say("err", "Please tick the confirmation box before sending."); return; }
    if (!data.company || !data.name || !data.email || !data.country || !data.category || !data.specification || !data.quantity || !data.destination_port) {
      say("err", "Please complete the fields marked with an asterisk.");
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

    fetch("/api/inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok && res.body && res.body.ok) {
          form.innerHTML =
            '<div class="callout green"><strong>Thank you — your requirement has been received.</strong><br>' +
            'I will come back to you within one business day, by email or on WhatsApp. If you sent a full specification, expect a factory shortlist and compared quotations.</div>' +
            '<p class="small muted">Nothing is due before the scope and the fee are agreed in writing.</p>';
          window.scrollTo({ top: form.offsetTop - 140, behavior: "smooth" });
        } else {
          say("err", (res.body && res.body.error) || "Something went wrong. Please try again, or message me on WhatsApp.");
          if (btn) { btn.disabled = false; btn.textContent = "Send inquiry"; }
        }
      })
      .catch(function () {
        say("err", "The message could not be sent from this preview. On the live site it sends normally — or message me on WhatsApp.");
        if (btn) { btn.disabled = false; btn.textContent = "Send inquiry"; }
      });
  });
})();
