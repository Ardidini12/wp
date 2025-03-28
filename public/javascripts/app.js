// Main app JavaScript

document.addEventListener('DOMContentLoaded', function() {
  // Mobile menu toggle
  const appContainer = document.querySelector('.app-container');
  const menuToggle = document.createElement('div');
  menuToggle.className = 'menu-toggle';
  menuToggle.innerHTML = '<i class="fas fa-bars"></i>';
  document.body.appendChild(menuToggle);
  
  menuToggle.addEventListener('click', function() {
    appContainer.classList.toggle('sidebar-open');
    menuToggle.innerHTML = appContainer.classList.contains('sidebar-open') 
      ? '<i class="fas fa-times"></i>' 
      : '<i class="fas fa-bars"></i>';
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', function(event) {
    if (window.innerWidth <= 992 && 
        !event.target.closest('.app-sidebar') && 
        !event.target.closest('.menu-toggle') && 
        appContainer.classList.contains('sidebar-open')) {
      appContainer.classList.remove('sidebar-open');
      menuToggle.innerHTML = '<i class="fas fa-bars"></i>';
    }
  });

  // Add this script to the layout.pug to enable it
  console.log('BSS Sender app initialized');
}); 