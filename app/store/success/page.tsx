import type { Metadata } from "next";
import SuccessClient from "./success-client";

export const metadata: Metadata = {
  title: "josefine — thanks",
  robots: { index: false },
};

export default function SuccessPage() {
  return <SuccessClient />;
}
