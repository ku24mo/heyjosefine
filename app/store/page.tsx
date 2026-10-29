import type { Metadata } from "next";
import StoreClient from "./store-client";

export const metadata: Metadata = {
  title: "josefine — photo drops",
  description: "real photos, straight from her camera roll.",
};

export default function StorePage() {
  return <StoreClient />;
}
