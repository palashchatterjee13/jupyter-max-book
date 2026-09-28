export default function JupyterLogo() {
  return (
    <svg className="jp-JupyterLogo" viewBox="0 0 132 36" height="28" aria-label="Jupyter" role="img">
      <g transform="translate(2 2)">
        {/* orbit mark */}
        <path d="M2 11.5C6 3.5 26 3.5 30 11.5C24.5 7.2 7.5 7.2 2 11.5Z" fill="#F37726" />
        <path d="M2 21.5C6 29.5 26 29.5 30 21.5C24.5 25.8 7.5 25.8 2 21.5Z" fill="#F37726" />
        <circle cx="27.5" cy="2.5" r="2.2" fill="#767677" />
        <circle cx="4.2" cy="29.4" r="2.8" fill="#989798" />
        <circle cx="5" cy="4.6" r="1.4" fill="#6F7070" />
      </g>
      <text
        x="40"
        y="25"
        fill="#4E4E4E"
        fontFamily="var(--jp-ui-font-family)"
        fontSize="22"
        letterSpacing="0.3"
      >
        jupyter
      </text>
    </svg>
  );
}
