import ResidentAuthScreen from "./ResidentAuthScreen";

export default function WelcomeScreen({ onContinueGuest, onSignedIn }) {
  return (
    <ResidentAuthScreen
      onContinueGuest={onContinueGuest}
      onSignedIn={onSignedIn}
    />
  );
}

