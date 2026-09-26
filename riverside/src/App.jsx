import { WorkspaceProvider } from '@culin/context/WorkspaceContext.jsx'
import DishSidebar from '@culin/components/DishSidebar.jsx'
import RiversideMast from './components/RiversideMast.jsx'
import RiversideSurface from './components/RiversideSurface.jsx'

export default function App({ initialFocus = null }) {
  return (
    <WorkspaceProvider
      initialFocus={initialFocus}
      initialLens="b"
      variant="riverside"
    >
      <RiversideMast />
      <div className="shell">
        <DishSidebar />
        <RiversideSurface />
      </div>
    </WorkspaceProvider>
  )
}
