// Optimized navigation component with inline styles and vanilla JS

// Self-executing function to avoid global scope pollution
(function () {
  // Create styles element with critical navigation CSS
  const navStyles = document.createElement("style");
  navStyles.textContent = `
    .nav-container {
      position: fixed;
      top: 0;
      width: 100%;
      z-index: 1000;
      background: #fff;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .nav-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem;
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .logo {
      font-weight: bold;
      font-size: 1.5rem;
    }
    
    .nav-links {
      display: flex;
      gap: 1.5rem;
    }
    
    .burger-menu {
      display: none;
      cursor: pointer;
      flex-direction: column;
      justify-content: space-between;
      height: 24px;
      width: 30px;
    }
    
    .burger-menu div {
      height: 3px;
      width: 100%;
      background: #333;
      transition: all 0.3s ease;
    }
    
    @media (max-width: 768px) {
      .nav-links {
        position: fixed;
        top: 60px;
        right: -100%;
        flex-direction: column;
        background: #fff;
        width: 100%;
        text-align: center;
        transition: 0.3s;
        box-shadow: 0 10px 27px rgba(0,0,0,0.05);
        padding: 2rem 0;
      }
      
      .nav-links.active {
        right: 0;
      }
      
      .burger-menu {
        display: flex;
      }
      
      .burger-menu.active div:nth-child(1) {
        transform: rotate(45deg) translate(5px, 5px);
      }
      
      .burger-menu.active div:nth-child(2) {
        opacity: 0;
      }
      
      .burger-menu.active div:nth-child(3) {
        transform: rotate(-45deg) translate(5px, -5px);
      }
    }
  `;

  document.head.appendChild(navStyles);

  // Create and insert the navigation HTML
  function createNavigation() {
    const nav = document.createElement("nav");
    nav.className = "nav-container";
    nav.innerHTML = `
      <div class="nav-content">
        <div class="logo">RBS Website</div>
        <div class="burger-menu">
          <div></div>
          <div></div>
          <div></div>
        </div>
        <ul class="nav-links">
          <li><a href="/">Home</a></li>
          <li><a href="/products">Products</a></li>
          <li><a href="/articles">Articles</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </div>
    `;

    // Prepend navigation to body
    document.body.prepend(nav);

    // Add burger menu functionality
    const burger = nav.querySelector(".burger-menu");
    const navLinks = nav.querySelector(".nav-links");

    burger.addEventListener("click", () => {
      navLinks.classList.toggle("active");
      burger.classList.toggle("active");
    });
  }

  // Initialize navigation once DOM is loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createNavigation);
  } else {
    createNavigation();
  }
})();
