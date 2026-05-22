import React, { useRef, useState, useEffect } from "react";

interface JoystickProps {
  pan: number;
  tilt: number;
  settings: {
    panMin: number;
    panMax: number;
    tiltMin: number;
    tiltMax: number;
    invertX: boolean;
    invertY: boolean;
    springMode: boolean;
  };
  onChange: (pan: number, tilt: number) => void;
}

export const Joystick: React.FC<JoystickProps> = ({
  pan,
  tilt,
  settings,
  onChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Calculate visual knob offset percentages (-50% to +50%) based on current servo angles
  const getKnobOffset = () => {
    const panRange = settings.panMax - settings.panMin;
    const tiltRange = settings.tiltMax - settings.tiltMin;
    
    // Percent from center (0 to 1)
    let panPercent = panRange > 0 ? (pan - settings.panMin) / panRange : 0.5;
    let tiltPercent = tiltRange > 0 ? (tilt - settings.tiltMin) / tiltRange : 0.5;

    if (settings.invertX) panPercent = 1 - panPercent;
    if (settings.invertY) tiltPercent = 1 - tiltPercent;

    // Map to knob displacement percentages (-100px to 100px for 200px boundary container)
    // -50% to +50%
    const x = (panPercent - 0.5) * 100;
    const y = (tiltPercent - 0.5) * 100;
    
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    containerRef.current.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updatePosition(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    updatePosition(e);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    
    if (settings.springMode) {
      // Snaps back to mid-range
      const panMid = Math.round((settings.panMax + settings.panMin) / 2);
      const tiltMid = Math.round((settings.tiltMax + settings.tiltMin) / 2);
      onChange(panMid, tiltMid);
    }
  };

  const updatePosition = (e: React.PointerEvent | PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    // Calculate raw offsets from center
    let dx = e.clientX - centerX;
    let dy = e.clientY - centerY;
    
    // Constrain to container radius (width / 2)
    const radius = rect.width / 2;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > radius) {
      dx = (dx / distance) * radius;
      dy = (dy / distance) * radius;
    }
    
    // Map -radius to +radius into 0.0 to 1.0 percent range
    let xPercent = (dx / radius + 1) / 2; // 0 (left) to 1 (right)
    let yPercent = (dy / radius + 1) / 2; // 0 (top) to 1 (bottom) (or standard Cartesian coordinates)
    
    if (settings.invertX) {
      xPercent = 1 - xPercent;
    }
    // Web coordinates have Y pointing down, so drag down = more positive. Let's make drag down = higher tilt angular tilt, unless inverted
    if (settings.invertY) {
      yPercent = 1 - yPercent;
    }
    
    // Scale percent into min-max degrees
    const panRange = settings.panMax - settings.panMin;
    const tiltRange = settings.tiltMax - settings.tiltMin;
    
    const targetPan = Math.round(settings.panMin + xPercent * panRange);
    const targetTilt = Math.round(settings.tiltMin + yPercent * tiltRange);
    
    // Clamp to boundaries safely
    const clampedPan = Math.max(settings.panMin, Math.min(settings.panMax, targetPan));
    const clampedTilt = Math.max(settings.tiltMin, Math.min(settings.tiltMax, targetTilt));
    
    onChange(clampedPan, clampedTilt);
  };

  const offset = getKnobOffset();

  return (
    <div className="flex flex-col items-center justify-center select-none">
      {/* Outer Housing Ring */}
      <div
        id="joystick-housing"
        ref={containerRef}
        className={`relative w-64 h-64 rounded-full border-2 bg-zinc-950 flex items-center justify-center touch-none transition-all duration-150 ${
          isDragging
            ? "border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.3)] bg-radial from-rose-950/20 to-zinc-950"
            : "border-zinc-800 shadow-[inset_0_4px_16px_rgba(0,0,0,0.8)] bg-radial from-zinc-900 to-zinc-950"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        {/* Crosshair Grids */}
        <div id="crosshair-y" className="absolute w-full h-[1px] bg-zinc-800/60" />
        <div id="crosshair-x" className="absolute h-full w-[1px] bg-zinc-800/60" />
        
        {/* Radial Helper Rims */}
        <div id="helper-ring-inner" className="absolute w-1/3 h-1/3 rounded-full border border-dashed border-zinc-800/30" />
        <div id="helper-ring-mid" className="absolute w-2/3 h-2/3 rounded-full border border-dashed border-zinc-800/30" />
        
        {/* Joystick Center Point Marker */}
        <div className="absolute w-2 h-2 rounded-full bg-zinc-800" />

        {/* Floating Joystick Thumb Knob */}
        <div
          id="joystick-knob"
          className="absolute w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all duration-75"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            background: isDragging 
              ? "radial-gradient(circle, #f43f5e 0%, #be123c 100%)" 
              : "radial-gradient(circle, #3f3f46 0%, #18181b 100%)",
            border: isDragging ? "2px solid #fda4af" : "2px solid #52525b",
            boxShadow: isDragging 
              ? "0 10px 25px -5px rgba(244, 63, 94, 0.5), inset 0 -4px 8px rgba(0,0,0,0.5)" 
              : "0 10px 20px -5px rgba(0, 0, 0, 0.8), inset 0 -4px 8px rgba(0,0,0,0.4)"
          }}
        >
          {/* Inner metallic style circle */}
          <div className="w-12 h-12 rounded-full border border-zinc-700 bg-zinc-900/40 flex items-center justify-center">
            <div className={`w-3 h-3 rounded-full ${isDragging ? "bg-rose-200 animate-ping" : "bg-zinc-600"}`} />
          </div>
        </div>

        {/* Angular Angle Labels overlay */}
        <div className="absolute -top-6 text-[10px] font-mono tracking-wider text-zinc-500 font-semibold">TILT (Y): {tilt}°</div>
        <div className="absolute -bottom-6 text-[10px] font-mono tracking-wider text-zinc-500 font-semibold font-semibold">PAN (X): {pan}°</div>
      </div>

      {/* Axis Readout Sliders */}
      <div className="mt-10 grid grid-cols-2 gap-8 w-full max-w-sm">
        <div className="flex flex-col space-y-1">
          <div className="flex justify-between text-xs font-mono text-zinc-400">
            <span>PAN AXIS</span>
            <span className="text-zinc-500">{pan}°</span>
          </div>
          <div className="relative h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
            <div
              className="absolute h-full bg-rose-500/80 rounded-full transition-all duration-75"
              style={{
                left: `${((pan - settings.panMin) / (settings.panMax - settings.panMin)) * 100}%`,
                width: '4px',
                transform: 'translateX(-50%)'
              }}
            />
          </div>
        </div>

        <div className="flex flex-col space-y-1">
          <div className="flex justify-between text-xs font-mono text-zinc-400">
            <span>TILT AXIS</span>
            <span className="text-zinc-500">{tilt}°</span>
          </div>
          <div className="relative h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
            <div
              className="absolute h-full bg-rose-500/80 rounded-full transition-all duration-75"
              style={{
                left: `${((tilt - settings.tiltMin) / (settings.tiltMax - settings.tiltMin)) * 100}%`,
                width: '4px',
                transform: 'translateX(-50%)'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
