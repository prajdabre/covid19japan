// Injects required polyfills for IE11
import "core-js/stable";
import "whatwg-fetch";
import "classlist-polyfill";

// Add all non-polyfill deps below.
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import locI18next from "loc-i18next";

import { calculateTotals } from "./data/helper";
import header from "./components/Header";
import drawDailyIncreaseChart from "./components/DailyIncreaseChart";
import drawKpis from "./components/Kpi";
import mapDrawer from "./components/OutbreakMap";
import drawPrefectureTable from "./components/PrefectureTable";
import drawTrendChart from "./components/SpreadTrendChart";
import drawTrendChartLog from "./components/SpreadTrendChartLog";
import drawPrefectureTrajectoryChart from "./components/TrajectoryChart";
import drawTravelRestrictions from "./components/TravelRestrictions";

const {
  toggleLangPicker,
  updateTooltipLang,
  drawPageTitleCount,
  drawLastUpdated,
} = header;

const { drawMap, drawMapPrefectures } = mapDrawer;

import {
  LANG_CONFIG,
  JSON_PATH,
  SUPPORTED_LANGS,
  DDB_COMMON,
} from "./data/constants";
import travelRestrictions from "./data/travelRestrictions"; // refer to the keys under "countries" in the i18n files for names

mapboxgl.accessToken =
  "pk.eyJ1IjoicmV1c3RsZSIsImEiOiJjazZtaHE4ZnkwMG9iM3BxYnFmaDgxbzQ0In0.nOiHGcSCRNa9MD9WxLIm7g";
let LANG = "en";

// Global vars
const ddb = {
  ...DDB_COMMON,
  travelRestrictions,
};

let map = undefined;
let tippyInstances;

// IE11 forEach Polyfill
if ("NodeList" in window && !NodeList.prototype.forEach) {
  NodeList.prototype.forEach = (callback, thisArg) => {
    thisArg = thisArg || window;
    for (let i = 0; i < this.length; i++) {
      callback.call(thisArg, this[i], i, this);
    }
  };
}

// Fetches data from the JSON_PATH but applies an exponential
// backoff if there is an error.
const loadData = (callback) => {
  let delay = 2 * 1000; // 2 seconds

  const tryFetch = (retryFn) => {
    // Load the json data file
    fetch(JSON_PATH)
      .then((res) => res.json())
      .catch((networkError) => {
        retryFn(delay, networkError);
        delay *= 2; // exponential backoff.
      })
      .then((data) => {
        // If there was a network error, data will null.
        if (data) {
          callback(data);
        }
      });
  };

  const retryFetchWithDelay = (delay, err) => {
    console.log(`${err}: retrying after ${delay}ms.`);
    setTimeout(() => {
      tryFetch(retryFetchWithDelay);
    }, delay);
  };

  tryFetch(retryFetchWithDelay);
};

// Keep a reference around to destroy it if we redraw this.
let trendChart = null;

// Keep a reference around to destroy it if we redraw this.
let trendChartLog = null;

// Keep reference to current chart in order to clean up when redrawing.
let dailyIncreaseChart = null;

// Keep reference to chart in order to destroy it when redrawing.
let prefectureTrajectoryChart = null;

// Dictionary of all the trend charts so that we can cleanup when redrawing.
let prefectureTrendCharts = {};

// localize must be accessible globally
const localize = locI18next.init(i18next);

const setLang = (lng) => {
  if (lng && lng.length > 1) {
    // Clip to first two letters of the language.
    let proposedLng = lng.slice(0, 2);
    // Don't set the lang if it's not the supported languages.
    if (SUPPORTED_LANGS.includes(proposedLng)) {
      LANG = proposedLng;
    }
  }

  toggleLangPicker(LANG);

  // set i18n framework lang
  i18next.changeLanguage(LANG).then(() => {
    localize("html");
    // Update the map
    if (styleLoaded) {
      map.getStyle().layers.forEach((thisLayer) => {
        if (thisLayer.type == "symbol") {
          map.setLayoutProperty(thisLayer.id, "text-field", [
            "get",
            `name_${LANG}`,
          ]);
        }
      });
    }

    // Redraw all components that need rerendering to be localized the prefectures table
    if (!document.body.classList.contains("embed-mode")) {
      if (document.getElementById("travel-restrictions")) {
        drawTravelRestrictions(ddb);
      }
      prefectureTrajectoryChart = drawPrefectureTrajectoryChart(
        ddb.prefectures,
        prefectureTrajectoryChart,
        LANG
      );
    }

    tippyInstances = updateTooltipLang(tippyInstances);
  });
};

const initDataTranslate = () => {
  // load translation framework
  i18next
    .use(LanguageDetector)
    .init(LANG_CONFIG)
    .then(() => {
      setLang(i18next.language);
    });

  // Language selector event handler
  if (document.querySelectorAll("[data-lang-picker]")) {
    document.querySelectorAll("[data-lang-picker]").forEach((pick) => {
      pick.addEventListener("click", (e) => {
        e.preventDefault();
        setLang(e.target.dataset.langPicker);
      });
    });
  }
};

let pageDraws = 0;
let styleLoaded = false;
let jsonData = undefined;
const whenMapAndDataReady = (ddb, map) => {
  // This runs drawMapPref only when
  // both style and json data are ready
  if (!styleLoaded || !jsonData) {
    return;
  }
  drawMapPrefectures(pageDraws, ddb, map);
};

const loadDataOnPage = () => {
  loadData((data) => {
    jsonData = data;

    ddb.prefectures = jsonData.prefectures;
    let newTotals = calculateTotals(jsonData.daily);
    ddb.totals = newTotals[0];
    ddb.totalsDiff = newTotals[1];
    ddb.trend = jsonData.daily;
    ddb.lastUpdated = jsonData.updated;

    drawKpis(ddb.totals, ddb.totalsDiff);
    if (!document.body.classList.contains("embed-mode")) {
      drawLastUpdated(ddb.lastUpdated, LANG);
      drawPageTitleCount(ddb.totals.confirmed);
      prefectureTrendCharts = drawPrefectureTable(
        ddb.prefectures,
        ddb.totals,
        prefectureTrendCharts
      );
      drawTravelRestrictions(ddb);
      trendChart = drawTrendChart(ddb.trend, trendChart);
      trendChartLog = drawTrendChartLog(ddb.trend, trendChartLog);
      dailyIncreaseChart = drawDailyIncreaseChart(
        ddb.trend,
        dailyIncreaseChart
      );
      prefectureTrajectoryChart = drawPrefectureTrajectoryChart(
        ddb.prefectures,
        prefectureTrajectoryChart,
        LANG
      );
    }

    whenMapAndDataReady(ddb, map);
  });
};

window.onload = () => {
  initDataTranslate(setLang);
  map = drawMap(mapboxgl, map);

  map.once("style.load", () => {
    styleLoaded = true;

    map.getStyle().layers.forEach((thisLayer) => {
      if (thisLayer.type == "symbol") {
        map.setLayoutProperty(thisLayer.id, "text-field", [
          "get",
          `name_${LANG}`,
        ]);
      }
    });
    whenMapAndDataReady(ddb, map);
  });
  loadDataOnPage();

  // Reload data every five minutes
  const FIVE_MINUTES_IN_MS = 300000;
  const recursiveDataLoad = () => {
    pageDraws++;
    loadDataOnPage();
    setTimeout(recursiveDataLoad, FIVE_MINUTES_IN_MS);
  };

  setTimeout(recursiveDataLoad, FIVE_MINUTES_IN_MS);
};
