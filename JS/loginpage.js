document.querySelectorAll('.toggle-pw').forEach((btn) => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        btn.querySelector('i').className = hidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    });
});