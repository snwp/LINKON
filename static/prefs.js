// Aplica tema e idioma antes da primeira pintura, para o app não piscar no tema escuro ao abrir.
try {
  var t = localStorage.getItem('linkon.theme');
  if (t && t !== 'escuro') document.documentElement.dataset.theme = t;
  var l = localStorage.getItem('linkon.lang');
  if (l) document.documentElement.lang = l;
} catch (e) {}
