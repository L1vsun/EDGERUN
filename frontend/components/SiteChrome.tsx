import TokenBanner from "./TokenBanner";
import Header from "./Header";
import Marquee from "./Marquee";
import Footer from "./Footer";
import EasterEgg from "./EasterEgg";

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
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
