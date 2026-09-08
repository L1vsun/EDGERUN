import Hero from "@/components/Hero";
import LiveFeed from "@/components/LiveFeed";
import Sidebar from "@/components/Sidebar";

export default function Home() {
  return (
    <>
      <Hero />

      <section className="block" style={{ paddingTop: 8 }}>
        <div className="container-wide">
          <div className="dash-grid">
            <div className="dash-main">
              <LiveFeed />
            </div>
            <Sidebar />
          </div>
        </div>
      </section>
    </>
  );
}
