import TokenBanner from "./TokenBanner";
import Header from "./Header";
import Marquee from "./Marquee";
import Footer from "./Footer";
import EasterEgg from "./EasterEgg";

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Ambient pools of light sit under everything — without them the
          frosted panels have nothing to refract and read as flat grey. */}
      <div className="ambient">
        <span />
      </div>
      <div className="grid-overlay" />
      <div className="grain" />
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
