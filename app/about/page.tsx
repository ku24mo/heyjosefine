import type { Metadata } from "next";
import AboutClient from "./about-client";

export const metadata: Metadata = {
  title: "josefine",
  description:
    "she has a lecture at 8 and a dog who steals socks. she remembers what you told her last tuesday. sometimes she texts first.",
};

export default function AboutPage() {
  return <AboutClient />;
}
