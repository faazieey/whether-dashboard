
const API_KEY = "c40b7be50ec09ba3a80f322c2f6ed266";

const BASE_URL = "https://api.openweathermap.org/data/2.5";
const ICON_URL = "https://openweathermap.org/img/wn";

const cityInput = document.getElementById("cityInput");
const searchForm = document.getElementById("searchForm");
const searchBtn = searchForm.querySelector("button[type='submit']");
const weatherCard = document.getElementById("weatherCard");
const errorMsg = document.getElementById("errorMsg");
const statusEl = document.getElementById("status");
const forecastList = document.getElementById("forecastList");
const favoritesList = document.getElementById("favoritesList");
const favoriteBtn = document.getElementById("favoriteBtn");
const suggestions = document.getElementById("suggestions");
const themeBtn = document.getElementById("themeBtn");

let currentCity = "";
let currentWeather = null;
let debounceTimer;
let suggestionController;
let searchController;

// Read favorites safely from localStorage.
function getFavorites() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("weatherFavorites") || "[]"
    );

    return Array.isArray(saved)
      ? saved.filter(city => typeof city === "string")
      : [];
  } catch {
    return [];
  }
}

// All weather API requests use fetch + async/await.
async function fetchJSON(url, signal) {
  const response = await fetch(url, { signal });
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "API key is invalid or not active yet. Check your key and try again later."
      );
    }

    if (response.status === 404) {
      throw new Error("City not found. Check the spelling and try again.");
    }

    if (response.status === 429) {
      throw new Error("API request limit reached. Please try again later.");
    }

    throw new Error(data.message || "Unable to fetch weather data.");
  }

  return data;
}

async function getWeather(city, signal) {
  const url =
    `${BASE_URL}/weather?q=${encodeURIComponent(city)}` +
    `&appid=${API_KEY}&units=metric`;

  const data = await fetchJSON(url, signal);

  return {
    city: data.name,
    country: data.sys.country,
    temp: Math.round(data.main.temp),
    feelsLike: Math.round(data.main.feels_like),
    description: data.weather[0].description,
    icon: data.weather[0].icon,
    humidity: data.main.humidity,
    windSpeed: data.wind.speed,
    pressure: data.main.pressure
  };
}

async function getForecast(city, signal) {
  const url =
    `${BASE_URL}/forecast?q=${encodeURIComponent(city)}` +
    `&appid=${API_KEY}&units=metric`;

  const data = await fetchJSON(url, signal);

  // The API returns forecasts in 3-hour intervals.
  // Select the forecast closest to midday for each day.
  const daily = new Map();

  for (const item of data.list) {
    const date = item.dt_txt.split(" ")[0];
    const hour = Number(item.dt_txt.split(" ")[1].slice(0, 2));

    if (!daily.has(date)) {
      daily.set(date, item);
    }

    const previous = daily.get(date);
    const previousHour = Number(
      previous.dt_txt.split(" ")[1].slice(0, 2)
    );

    if (
      Math.abs(hour - 12) <
      Math.abs(previousHour - 12)
    ) {
      daily.set(date, item);
    }
  }

  return [...daily.entries()].slice(0, 5).map(([date, item]) => ({
    date,
    temp: Math.round(item.main.temp),
    description: item.weather[0].description,
    icon: item.weather[0].icon
  }));
}

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.hidden = false;
}

function clearError() {
  errorMsg.textContent = "";
  errorMsg.hidden = true;
}

function setLoading(loading) {
  searchBtn.disabled = loading;
  searchBtn.textContent = loading ? "Loading..." : "Search";
  statusEl.textContent = loading ? "Loading weather..." : "";
}

function renderWeather(weather) {
  document.getElementById("cityName").textContent =
    `${weather.city}, ${weather.country}`;

  document.getElementById("weatherDescription").textContent =
    weather.description;

  document.getElementById("temperature").textContent = weather.temp;
  document.getElementById("feelsLike").textContent = weather.feelsLike;
  document.getElementById("humidity").textContent = `${weather.humidity}%`;
  document.getElementById("windSpeed").textContent =
    `${weather.windSpeed} m/s`;
  document.getElementById("pressure").textContent =
    `${weather.pressure} hPa`;

  const icon = document.getElementById("weatherIcon");
  icon.src = `${ICON_URL}/${weather.icon}@2x.png`;
  icon.alt = weather.description;

  document.getElementById("updatedAt").textContent =
    `Updated ${new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })}`;

  weatherCard.hidden = false;
  updateFavoriteButton();
}

function renderForecast(forecast) {
  forecastList.replaceChildren();

  for (const day of forecast) {
    const card = document.createElement("article");
    card.className = "forecast-card";

    const date = new Date(`${day.date}T12:00:00`);
    const dayName = date.toLocaleDateString("en", {
      weekday: "short"
    });

    const dateText = date.toLocaleDateString("en", {
      day: "numeric",
      month: "short"
    });

    const title = document.createElement("div");
    title.className = "day";
    title.textContent = `${dayName}, ${dateText}`;

    const icon = document.createElement("img");
    icon.src = `${ICON_URL}/${day.icon}@2x.png`;
    icon.alt = day.description;

    const description = document.createElement("p");
    description.textContent = day.description;

    const temperature = document.createElement("strong");
    temperature.textContent = `${day.temp}°C`;

    card.append(title, icon, description, temperature);
    forecastList.append(card);
  }
}

async function searchWeather(city) {
  city = city.trim();

  if (!city) {
    showError("Please enter a city name.");
    return;
  }

  if (API_KEY === "YOUR_API_KEY_HERE") {
    showError("Add your OpenWeatherMap API key in script.js first.");
    return;
  }

  // Cancel a previous search if a newer one starts.
  searchController?.abort();
  searchController = new AbortController();

  const { signal } = searchController;

  clearError();
  setLoading(true);
  suggestions.classList.remove("show");

  try {
    // Fetch current weather and forecast concurrently.
    const [weather, forecast] = await Promise.all([
      getWeather(city, signal),
      getForecast(city, signal)
    ]);

    // Ignore stale results from cancelled requests.
    if (signal.aborted) return;

    currentWeather = weather;
    currentCity = weather.city;

    renderWeather(weather);
    renderForecast(forecast);
    renderFavorites();
  } catch (error) {
    if (error.name === "AbortError") return;

    showError(error.message);
  } finally {
    if (!signal.aborted) {
      setLoading(false);
    }
  }
}

function updateFavoriteButton() {
  const saved = getFavorites().some(
    city => city.toLowerCase() === currentCity.toLowerCase()
  );

  favoriteBtn.textContent = saved
    ? "★ Remove favorite"
    : "☆ Add favorite";
}

function addFavorite(city) {
  city = city.trim();

  if (!city) return;

  const favorites = getFavorites();

  const exists = favorites.some(
    item => item.toLowerCase() === city.toLowerCase()
  );

  if (exists) return;

  favorites.push(city);
  localStorage.setItem("weatherFavorites", JSON.stringify(favorites));

  renderFavorites();
  updateFavoriteButton();
}

function removeFavorite(city) {
  const favorites = getFavorites().filter(
    item => item.toLowerCase() !== city.toLowerCase()
  );

  localStorage.setItem("weatherFavorites", JSON.stringify(favorites));

  renderFavorites();
  updateFavoriteButton();
}

function renderFavorites() {
  favoritesList.replaceChildren();

  const favorites = getFavorites();

  if (favorites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No favorite cities yet. Add one after searching.";
    favoritesList.append(empty);
    return;
  }

  for (const city of favorites) {
    const card = document.createElement("div");
    card.className = "favorite-card";

    const selectBtn = document.createElement("button");
    selectBtn.className = "city-select";
    selectBtn.textContent = city;
    selectBtn.addEventListener("click", () => {
      cityInput.value = city;
      searchWeather(city);
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${city}`);
    removeBtn.addEventListener("click", () => removeFavorite(city));

    card.append(selectBtn, removeBtn);
    favoritesList.append(card);
  }
}

// 500 ms debounced search suggestions.
// OpenWeatherMap's geocoding endpoint supplies city matches.
async function loadSuggestions(query) {
  suggestionController?.abort();

  if (query.length < 2 || API_KEY === "YOUR_API_KEY_HERE") {
    suggestions.classList.remove("show");
    return;
  }

  suggestionController = new AbortController();

  try {
    const url =
      `https://api.openweathermap.org/geo/1.0/direct?q=` +
      `${encodeURIComponent(query)}&limit=5&appid=${API_KEY}`;

    const cities = await fetchJSON(url, suggestionController.signal);

    suggestions.replaceChildren();

    for (const city of cities) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion-item";
      button.textContent =
        `${city.name}, ${city.state ? city.state + ", " : ""}${city.country}`;

      button.addEventListener("click", () => {
        cityInput.value = city.name;
        suggestions.classList.remove("show");
        searchWeather(city.name);
      });

      suggestions.append(button);
    }

    suggestions.classList.toggle("show", cities.length > 0);
  } catch (error) {
    if (error.name !== "AbortError") {
      suggestions.classList.remove("show");
    }
  }
}

cityInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);

  const query = cityInput.value.trim();

  debounceTimer = setTimeout(() => {
    loadSuggestions(query);
  }, 500);
});

searchForm.addEventListener("submit", event => {
  event.preventDefault();
  searchWeather(cityInput.value);
});

favoriteBtn.addEventListener("click", () => {
  if (!currentCity) return;

  const exists = getFavorites().some(
    city => city.toLowerCase() === currentCity.toLowerCase()
  );

  if (exists) {
    removeFavorite(currentCity);
  } else {
    addFavorite(currentCity);
  }
});

themeBtn.addEventListener("click", () => {
  const dark = document.body.classList.toggle("dark");

  themeBtn.textContent = dark ? "☀ Light" : "🌙 Dark";

  localStorage.setItem("weatherTheme", dark ? "dark" : "light");
});

function loadFavorites() {
  renderFavorites();
}

function loadTheme() {
  const dark = localStorage.getItem("weatherTheme") === "dark";

  document.body.classList.toggle("dark", dark);
  themeBtn.textContent = dark ? "☀ Light" : "🌙 Dark";
}

document.addEventListener("DOMContentLoaded", () => {
  loadFavorites();
  loadTheme();
});
