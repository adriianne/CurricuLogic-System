/* themeinit.js: apply the saved (or system) theme before anything is drawn, so
   there is no white flash. Loaded from <head> as a plain blocking script, which is
   what makes it run before the first paint. See shared/js/app/theme.js for the toggle.

   It is a file, not an inline <script>, so the Content-Security-Policy can forbid
   inline scripts altogether. */
try {
    var t = localStorage.getItem('curriculogic-theme');
    if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
} catch (e) { /* storage blocked: the page opens light */ }
