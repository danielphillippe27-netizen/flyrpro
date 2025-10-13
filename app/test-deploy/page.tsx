export default function TestDeployPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-green-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-green-800 mb-4">
          ✅ DEPLOYMENT WORKING!
        </h1>
        <p className="text-green-600 mb-4">
          This page was created at: {new Date().toISOString()}
        </p>
        <p className="text-green-600">
          If you can see this, the deployment is working correctly.
        </p>
      </div>
    </div>
  );
}
