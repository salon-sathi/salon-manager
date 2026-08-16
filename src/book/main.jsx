// Entry point for the public booking page (book/index.html → <base>book/).
//
// Deliberately NOT src/main.jsx. Three differences, each of them on purpose:
//
//  • No registerServiceWorker(). The worker's job is to make the STAFF app's shell open with no
//    network; this page reads live availability, so an offline copy of it would show a customer
//    slots that may already be gone. It is online-only by design.
//  • No auth, no shell, no views. See BookingPage.jsx.
//  • Its own error boundary, worded for a customer rather than for the salon.

import { StrictMode, Component } from "react";
import { createRoot } from "react-dom/client";
import BookingPage from "./BookingPage.jsx";

class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error("booking page crashed", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // No stack, no "report this" — the person reading it came here to book a haircut.
    return (
      <div style={{ maxWidth: 460, margin: "60px auto", padding: 24, textAlign: "center", fontFamily: "inherit", lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ color: "#6B7E74", marginBottom: 16 }}>
          We couldn't load the booking page. Please try again, or give the salon a call to book.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: "12px 20px", minHeight: 48, border: "none", borderRadius: 10, background: "#1B5E43", color: "#fff", font: "inherit", fontWeight: 700, cursor: "pointer" }}
        >
          Try again
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Boundary>
      <BookingPage />
    </Boundary>
  </StrictMode>
);
