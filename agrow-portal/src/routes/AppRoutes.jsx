import { Routes, Route } from 'react-router-dom'
import LandingPage from '../features/landing/LandingPage'
import DashboardView from '../features/dashboard/DashboardView'
import DashboardLayout from '../layouts/DashboardLayout'
import HeatmapView from '../features/heatmap/HeatmapView'
import PredictionViews from '../features/prediction/PredictionViews'
import StatisticViews from '../features/statistic/StatisticViews'
import SettingViews from '../features/setting/SettingViews'
import LoginPage from '../features/auth/LoginPage'

export default function AppRoutes(){
    return(
        <Routes>
            <Route path="/" element={<LandingPage/>}/>
            <Route path="/login" element={<LoginPage/>}/>

            <Route path="/dashboard" element={<DashboardLayout/>}>
                <Route index element={<DashboardView/>}/>
                <Route path='heatmap-analysis' element={<HeatmapView/>}/>
                <Route path='ai-predictions' element={<PredictionViews/>}/>
                <Route path='crop-statistics' element={<StatisticViews/>}/>
                <Route path='settings' element={<SettingViews/>}/>
            </Route>
        </Routes>
    )
}
