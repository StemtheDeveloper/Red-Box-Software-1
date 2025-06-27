const grid = document.querySelector(".grid");
const itemSize = 40; // Size of each item in pixels
const columns = Math.floor(window.innerWidth / (itemSize + 3)); // 3px gap
const rows = Math.floor(window.innerHeight / (itemSize + 3));
const itemsCount = columns * rows;

grid.style.gridTemplateColumns = `repeat(${columns}, ${itemSize}px)`;
grid.style.gridTemplateRows = `repeat(${rows}, ${itemSize}px)`;

grid.classList.add("list");

for (let i = 0; i < itemsCount; i++) {
  const div = document.createElement("div");
  div.style.backgroundColor = "rgb(209, 29, 29)";
  div.classList.add("item");
  grid.appendChild(div);
}

const listItems = document.querySelectorAll(".item");
let effectArea = 1;

document.getElementById("effect-range").addEventListener("input", (event) => {
  effectArea = parseInt(event.target.value);
});

// listItems.forEach((item, index) => {
//   item.addEventListener("mouseover", () => {
//     item.style.filter = "brightness(1)";
//     item.style.transform = "translateZ(100px)";

//     for (let i = -effectArea; i <= effectArea; i++) {
//       for (let j = -effectArea; j <= effectArea; j++) {
//         const currentIndex = index + i * columns + j;
//         if (
//           currentIndex >= 0 &&
//           currentIndex < listItems.length &&
//           Math.floor(currentIndex / columns) ===
//             Math.floor((index + i * columns) / columns)
//         ) {
//           if (i === 0 && j === 0) continue; // Skip the hovered item
//           listItems[currentIndex].style.filter = "brightness(0.6)";
//           listItems[
//             currentIndex
//           ].style.transform = `translateZ(75px) rotateY(${
//             40 * j
//           }deg) rotateX(${40 * i}deg)`;
//         }
//       }
//     }
//   });

//   item.addEventListener("mouseout", () => {
//     item.style.filter = "brightness(0)";
//     item.style.transform = "none";

//     for (let i = -effectArea; i <= effectArea; i++) {
//       for (let j = -effectArea; j <= effectArea; j++) {
//         const currentIndex = index + i * columns + j;
//         if (
//           currentIndex >= 0 &&
//           currentIndex < listItems.length &&
//           Math.floor(currentIndex / columns) ===
//             Math.floor((index + i * columns) / columns)
//         ) {
//           if (i === 0 && j === 0) continue; // Skip the hovered item
//           listItems[currentIndex].style.filter = "brightness(0)";
//           listItems[currentIndex].style.transform = "none";
//         }
//       }
//     }
//   });
// });

// Adjust grid on window resize
window.addEventListener("resize", () => {
  location.reload();
});
