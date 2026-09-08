import TokenBanner from "./TokenBanner";
import Header from "./Header";
import Marquee from "./Marquee";
import Footer from "./Footer";
import EasterEgg from "./EasterEgg";

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Structural grid, not atmosphere: the light theme gets its depth from
          hard borders and solid offset shadows rather than blur or glow. */}
      <div className="grid-overlay" />
      <div className="sticky-chrome">
        <TokenBanner />
        <Header />
        <Marquee />
      </div>
      {children}
      <Footer />
      <EasterEgg />
    </>
  );
}
