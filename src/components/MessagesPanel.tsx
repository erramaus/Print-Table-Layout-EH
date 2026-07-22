interface MessagesPanelProps {
  messages: string[];
}

function MessagesPanel({ messages }: MessagesPanelProps) {
  return (
    <section className="messages-card">
      <div className="messages-header">
        <h3>Messages</h3>
        <span>Version 1</span>
      </div>
      {messages.length === 0 ? (
        <p className="stats-empty">Optimization messages will appear here.</p>
      ) : (
        <ul className="messages-list">
          {messages.map((message, index) => (
            <li key={`${message}-${index}`}>{message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default MessagesPanel;
