import type { Metadata } from "next";
import LinksClient from "./links-client";

export const metadata: Metadata = {
  title: "josefine — links",
  description: "text me · photo drops · telegram soon",
};

export default function LinksPage() {
  return <LinksClient />;
}
