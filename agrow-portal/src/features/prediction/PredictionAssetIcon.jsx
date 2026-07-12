export default function PredictionAssetIcon({ src }) {
  return (
    <span
      className="prediction-icon-mask"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: src }}
    />
  )
}
