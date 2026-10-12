import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs'

const meta = {
  title: 'Primitives/Tabs',
  component: Tabs,
  args: { defaultValue: 'watching' },
  render: (args) => (
    <Tabs {...args}>
      <TabsList aria-label="Library">
        <TabsTrigger value="watching">Watching</TabsTrigger>
        <TabsTrigger value="list">My list</TabsTrigger>
        <TabsTrigger value="finished">Finished</TabsTrigger>
      </TabsList>
      <TabsContent value="watching">Shows you are in the middle of.</TabsContent>
      <TabsContent value="list">Shows you saved for later.</TabsContent>
      <TabsContent value="finished">Shows you have finished.</TabsContent>
    </Tabs>
  ),
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
