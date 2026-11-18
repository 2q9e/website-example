const header = document.querySelector(".site-header");
const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#site-nav");
const colorButtons = Array.from(document.querySelectorAll(".color-option"));
const sceneRoot = document.querySelector(".scroll-scene");
const colourStatus = document.querySelector("#colour-status");
const saveButton = document.querySelector("#save-colour");
const saveLabel = document.querySelector("#save-colour-label");
const currentColourName = document.querySelector("#current-colour-name");
const capSlider = document.querySelector("#cap-progress");
const capStatus = document.querySelector("#cap-status");
const year = document.querySelector("#current-year");
const palette = {
  tidepool: "Abyss Jade",
  clementine: "Solar Flare",
  lichen: "Night Orchid"
};
const storageKey = "rill-saved-colour";
const mobileMenu = window.matchMedia("(max-width: 720px)");

let selectedColour = "tidepool";
let persistedColour = null;
let visitOnlyColour = null;
let storageProblem = false;

function setMenu(open, restoreFocus) {
  if (!header || !menuButton) return;
  header.dataset.navOpen = open ? "true" : "false";
  menuButton.setAttribute("aria-expanded", open ? "true" : "false");
  menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  const label = menuButton.querySelector(".menu-toggle__label");
  if (label) label.textContent = open ? "Close" : "Menu";
  if (restoreFocus) menuButton.focus();
}

function announceColour(message) {
  if (colourStatus) colourStatus.textContent = message;
}

function updateSaveControl() {
  if (!saveButton || !saveLabel) return;
  const removedThisVisit = storageProblem && persistedColour === null && visitOnlyColour === null;
  const saved = !removedThisVisit && (persistedColour === selectedColour || visitOnlyColour === selectedColour);
  saveButton.setAttribute("aria-pressed", saved ? "true" : "false");
  saveLabel.textContent = saved ? "Saved on this device" : "Save this colour";
}

function selectColour(colour, announceChange) {
  if (!Object.prototype.hasOwnProperty.call(palette, colour)) return;
  selectedColour = colour;
  if (sceneRoot) sceneRoot.dataset.color = colour;

  colorButtons.forEach(function (button) {
    const active = button.dataset.color === colour;
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  if (currentColourName) currentColourName.textContent = palette[colour];

  document.dispatchEvent(new CustomEvent("rill:colorchange", {
    detail: { color: colour }
  }));

  updateSaveControl();
  if (announceChange) announceColour("Preview colour changed to " + palette[colour] + ".");
}

function setCapProgress(value) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  const progress = percent / 100;
  if (sceneRoot) {
    sceneRoot.style.setProperty("--cap-shift-x", (progress * 34).toFixed(1) + "px");
    sceneRoot.style.setProperty("--cap-shift-y", (progress * -27).toFixed(1) + "px");
    sceneRoot.style.setProperty("--cap-rotation", (progress * 18).toFixed(1) + "deg");
    sceneRoot.dataset.capOpen = progress >= 0.98 ? "true" : "false";
  }
  if (capSlider) {
    capSlider.setAttribute("aria-valuetext", progress >= 0.98 ? "Cap open" : percent === 0 ? "Cap closed" : Math.round(percent) + " percent open");
  }
  document.dispatchEvent(new CustomEvent("rill:capprogress", {
    detail: { progress: progress }
  }));
}

if (year) year.textContent = String(new Date().getFullYear());

try {
  const stored = window.localStorage.getItem(storageKey);
  if (Object.prototype.hasOwnProperty.call(palette, stored)) persistedColour = stored;
} catch (error) {
  storageProblem = true;
}

if (persistedColour) selectedColour = persistedColour;
selectColour(selectedColour, false);
if (capSlider) setCapProgress(capSlider.value);

colorButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    selectColour(button.dataset.color, true);
  });
});

if (capSlider) {
  capSlider.addEventListener("input", function () {
    setCapProgress(capSlider.value);
  });
  capSlider.addEventListener("change", function () {
    const isOpen = Number(capSlider.value) >= 98;
    if (capStatus) capStatus.textContent = isOpen ? "The cap is lifted and the bottle is open." : "The cap is back on the bottle.";
  });
}

if (saveButton) {
  saveButton.addEventListener("click", function () {
    const alreadySaved = persistedColour === selectedColour || visitOnlyColour === selectedColour;
    if (alreadySaved) {
      try {
        window.localStorage.removeItem(storageKey);
        persistedColour = null;
        visitOnlyColour = null;
        storageProblem = false;
        announceColour("Removed " + palette[selectedColour] + " from this browser.");
      } catch (error) {
        persistedColour = null;
        visitOnlyColour = null;
        storageProblem = true;
        announceColour("Browser storage could not be updated. This colour is no longer marked as saved for this visit.");
      }
    } else {
      try {
        window.localStorage.setItem(storageKey, selectedColour);
        persistedColour = selectedColour;
        visitOnlyColour = null;
        storageProblem = false;
        announceColour(palette[selectedColour] + " is saved on this device.");
      } catch (error) {
        persistedColour = null;
        visitOnlyColour = selectedColour;
        storageProblem = true;
        announceColour(palette[selectedColour] + " is saved for this visit only; browser storage is unavailable.");
      }
    }
    updateSaveControl();
  });
}

if (menuButton && navigation) {
  menuButton.addEventListener("click", function () {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    setMenu(!isOpen, false);
  });

  navigation.addEventListener("click", function (event) {
    const target = event.target;
    const link = target instanceof Element ? target.closest("a") : null;
    if (link) setMenu(false, false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenu(false, true);
    }
  });

  window.addEventListener("resize", function () {
    if (!mobileMenu.matches) setMenu(false, false);
  }, { passive: true });
  setMenu(false, false);
}


