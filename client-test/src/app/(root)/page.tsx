import Nav from "@/components/Nav";
import Org from "@/components/Org";
import Employees from "@/components/Employees";
import EmployeePortal from "@/components/EmployeePortal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const page = () => {
  return (
    <div className="w-full flex flex-col gap-8">
      <Nav />
      <Tabs defaultValue="org" className="w-full">
        <TabsList>
          <TabsTrigger value="org">Organization</TabsTrigger>
          <TabsTrigger value="employee">Employee</TabsTrigger>
        </TabsList>
        <TabsContent value="org" className="flex flex-col gap-8">
          <Org />
          <Employees />
        </TabsContent>
        <TabsContent value="employee">
          <EmployeePortal />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default page;
