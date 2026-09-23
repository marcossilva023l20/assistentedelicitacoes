import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "pdfjs-dist", "@unpdf/pdfjs-dist", "mammoth"],
};

export default nextConfig;
