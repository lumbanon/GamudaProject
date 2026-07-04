export default function PredictionAssetIcon({ src }) {
  return (
    <span
      className="prediction-icon-mask"
      aria-hidden="true"
      style={{ "--prediction-icon": `url(${src})` }}
    />
  )
}
