import { chromium, firefox, webkit } from "playwright";

export function studentBrowser(name = "chromium") {
  switch (name) {
    case "chromium": return chromium;
    case "firefox": return firefox;
    case "webkit": return webkit;
    default: throw new Error("Choose chromium, firefox or webkit for the student workspace browser checks.");
  }
}
