import { Box, Stack } from "@mui/material";
import { GetServerSideProps } from "next";

import AnalysisAssistant from "../../components/analysis/AnalysisAssistant";
import { AnalysisChart } from "../../components/analysisChart";
import DashboardContent from "../../components/dashboardContent";
import { addInitialStateToProps } from "../../lib/addInitialStateToProps";
import { requestContext } from "../../lib/requestContext";
import { PropsWithInitialState } from "../../lib/types";

export const getServerSideProps: GetServerSideProps<PropsWithInitialState> =
  requestContext(async (ctx, dfContext) => {
    return {
      props: addInitialStateToProps({
        serverInitialState: {},
        props: {},
        dfContext,
      }),
    };
  });

export default function AnalysisOverviewPage() {
  return (
    <DashboardContent>
      <Box sx={{ width: "100%", pl: 2, pr: 2, pt: 1 }}>
        <Stack spacing={2}>
          <AnalysisChart />
          <AnalysisAssistant />
        </Stack>
      </Box>
    </DashboardContent>
  );
}
