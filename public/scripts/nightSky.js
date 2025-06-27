document.querySelector(".night-sky").addEventListener("click", (e) => {
  // Create the shooting star element
  const shootingStar = document.createElement("div");
  shootingStar.classList.add("shooting-star");

  // Set the initial position of the shooting star
  shootingStar.style.left = `${e.clientX}px`;
  shootingStar.style.top = `${e.clientY}px`;

  // Add the shooting star to the document
  document.querySelector(".night-sky").appendChild(shootingStar);

  // Remove the shooting star after the animation is done
  shootingStar.addEventListener("animationend", () => {
    shootingStar.remove();
  });
});
