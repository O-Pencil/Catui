import { useConnectionStore } from "./connection/connection-store";
import { useSessionStore } from "./state/session-store";
import ConnectScreen from "./connection/ConnectScreen";
import ChatView from "./views/ChatView";

/**
 * Top-level routing: no remembered target -> connect screen; otherwise the
 * chat surface (which keeps rendering during auto-reconnect attempts).
 */
export default function App() {
	const current = useConnectionStore((s) => s.current);
	const status = useSessionStore((s) => s.status);

	if (!current || status === "idle") {
		return <ConnectScreen />;
	}
	return <ChatView />;
}
