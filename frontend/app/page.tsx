import TokenBanner from "@/components/TokenBanner";
import Hero from "@/components/Hero";
import LiveFeed from "@/components/LiveFeed";
import HowItWorks from "@/components/HowItWorks";
import Limitations from "@/components/Limitations";
import TokenUtility from "@/components/TokenUtility";
import VerifyYourself from "@/components/VerifyYourself";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <TokenBanner />
      <Hero />
      <LiveFeed />
      <HowItWorks />
      <Limitations />
      <TokenUtility />
      <VerifyYourself />
      <Footer />
    </>
  );
}
