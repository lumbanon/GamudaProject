import AppRoutes from "./routes/AppRoutes"
import { AppPreferencesProvider } from "./context/AppPreferencesContext"

function App() {
    return (
        <AppPreferencesProvider>
            <AppRoutes/>
        </AppPreferencesProvider>
    )
}

export default App
