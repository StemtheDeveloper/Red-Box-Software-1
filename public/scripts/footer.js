// Create a new footer element
const footer = document.createElement("footer");

footer.innerHTML = `
<footer class="site-footer">
    <div class="footer-content">
        <div class="footer-section">
            <h3>Contact Us</h3>
            <p>Phone: 0275433744</p>
            <p>Email:</p> <a href="mailto:stiaan@red-box-software.com">stiaan@red-box-software.com</a>
        </div>
        
        <div class="footer-section">
            <h3>Follow Us</h3>
            <div class="social-links">
                <a href="https://linkedin.com/company/red-box-software" target="_blank">LinkedIn</a>
                <div class="vr"></div>
                <a href="https://github.com/StemtheDeveloper" target="_blank">GitHub</a>
                <div class="vr"></div>
                <a href="https://www.facebook.com/profile.php?id=61554862180166" target="_blank">Facebook</a>
            </div>
        </div>

        <div class="footer-section">
            <h3>Quick Links</h3>
            <div class="quick-links"> 
            <a href="services.html">Services</a>
            <div class="vr"></div>
            <a href="about.html">About Us</a>
            <div class="vr"></div>
            <a href="contact.html">Contact</a>
            </div>
        </div>

    </div>
    
    <div class="footer-bottom">
        <p>&copy; ${new Date().getFullYear()} Red Box Software LTD. All rights reserved.</p>
    </div>

    <button id="back-to-top" title="Back to top">^</button>
</footer>
`;

document.body.appendChild(footer);

// Back to top button functionality
const backToTopButton = document.getElementById("back-to-top");

window.addEventListener("scroll", () => {
  if (window.pageYOffset > 300) {
    backToTopButton.style.display = "block";
  } else {
    backToTopButton.style.display = "none";
  }
});

backToTopButton.addEventListener("click", () => {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
});
