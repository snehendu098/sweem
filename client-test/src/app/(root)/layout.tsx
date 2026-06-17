import React from "react";

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="max-w-screen py-20 justify-center items-center flex flex-col">
      <div className="w-full max-w-6xl">{children}</div>
    </div>
  );
};

export default Layout;
