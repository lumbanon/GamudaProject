import "./landing-page.css";
import { Link } from "react-router-dom";
import agrowLogo from "../../assets/landing/agrow1.svg";
import kundasangPoster from "../../assets/landing/kundasang.png";
import landingVideo from "../../assets/landing/landing_page_video.mp4";
import logo1 from "../../assets/landing/logo1.png";
import logo2 from "../../assets/landing/logo2.png";
import logo3 from "../../assets/landing/logo3.png";
import mtKinabalu from "../../assets/landing/mtkinabalu.jpg";

const featureCards = [
  {
    title: "Interactive Map",
    body: "Explore Sabah districts with live raster layers and crop suitability overlays.",
    image: logo1,
    alt: "Interactive Map Logo",
  },
  {
    title: "Crop Suitability Heatmaps",
    body: "Compare a variety of regional crop requirements against local soil and environmental conditions.",
    image: logo2,
    alt: "Crop Suitability Heatmaps Logo",
  },
  {
    title: "Data Driven Decisions",
    body: "Turn satellite, soil, rainfall, and GIS data into practical planting guidance.",
    image: logo3,
    alt: "Data Driven Decisions Logo",
  },
];
const scrollToExplore = () => {
  const target = document.getElementById("explore");

  if (!target) return;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  target.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });
};

function LandingPage() {
  return (
    <div className="landing-page">
      <nav className="landing-nav" aria-label="Landing navigation">
        <Link to="/" className="landing-brand">
          <img
            src={agrowLogo}
            alt="AGROW by Cleek"
            className="landing-brand-logo"
          />
        </Link>
        <div className="landing-nav-links">
          <button
            type="button"
            className="landing-nav-button landing-nav-button-light"
            onClick={scrollToExplore}
          >
            Explore
          </button>
          <Link
            to="/login"
            state={{ fromLandingLogin: true }}
            className="landing-nav-button landing-nav-button-primary"
          >
            Login
          </Link>
        </div>
      </nav>

      <main>
        <section className="landing-hero">
          <img
            className="landing-hero-media"
            src={mtKinabalu}
            alt="Mount Kinabalu and Sabah highland landscape"
          />
          <div className="hero-copy">
            <h1>Data-Driven Crop Intelligence for Sabah's Future</h1>
            <p>
              Real-time satellite data, predictive ML, and GIS mapping help
              Sabah growers evaluate land, compare crop suitability, and plan
              with confidence.
            </p>
            <div className="landing-actions">
              <Link to="/dashboard" className="primary-button">
                Launch Workspace
              </Link>
              <Link
                to="/dashboard/heatmap-analysis"
                className="secondary-button"
              >
                Explore Map Layers
              </Link>
            </div>
          </div>
        </section>

        <section className="landing-feature-grid" id="explore">
          {featureCards.map((card) => (
            <article className="feature-card" key={card.title}>
              <img src={card.image} alt={card.alt} />
              <h2>{card.title}</h2>
              <p>{card.body}</p>
            </article>
          ))}
        </section>

        <section
          className="landing-image-section"
          aria-label="Sabah agriculture preview"
        >
          <video
            className="landing-preview-video"
            autoPlay
            muted
            loop
            playsInline
            poster={kundasangPoster}
          >
            <source src={landingVideo} type="video/mp4" />
          </video>
          <div>
            <span className="eyebrow">Sabah Crop Workspace</span>
            <h2>GIS-backed crop planning from coast to highland.</h2>
            <p>
              Cleek brings district maps, environmental rasters, heatmaps, and
              AI reporting into one focused agriculture dashboard.
            </p>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        &copy; 2026 AGROW BY CLEEK. ALL RIGHTS RESERVED.
      </footer>
    </div>
  );
}

export default LandingPage;
