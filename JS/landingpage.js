// landingpage.js - Landing page interactions

console.log('CurricuLogic Landing Page Loaded');

// Smooth fade-in on load
window.addEventListener('load', () => {
    document.querySelectorAll('.problem-item, .solution-item, .preview-item').forEach((el, index) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        setTimeout(() => {
            el.style.transition = 'all 0.5s ease';
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
});

// Button click tracking
document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        console.log('CTA Button Clicked:', btn.textContent.trim());
    });
});

// Highlight on hover
document.querySelectorAll('.problem-item, .solution-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
        item.style.opacity = '0.8';
        item.style.transform = 'translateX(8px)';
        item.style.transition = 'all 0.3s ease';
    });
    
    item.addEventListener('mouseleave', () => {
        item.style.opacity = '1';
        item.style.transform = 'translateX(0)';
    });
});

console.log('CurricuLogic ready to help students plan their courses');